use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use http_body_util::{BodyExt, BodyStream};
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::hyper::{Method, Request, Response, StatusCode, Uri};
use hudsucker::rcgen::{Issuer, KeyPair};
use hudsucker::rustls::crypto::aws_lc_rs;
use hudsucker::tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use hudsucker::tokio_tungstenite::tungstenite::protocol::CloseFrame;
use hudsucker::tokio_tungstenite::tungstenite::{Error as WsError, Message};
use hudsucker::{
    decode_request, decode_response, Body, HttpContext, HttpHandler, Proxy, RequestOrResponse,
    WebSocketContext, WebSocketHandler,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

const MAX_BODY: usize = 64 * 1024 * 1024;

static WS_IDS: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Handler {
    rewriter: String,
    hosts: Arc<HashSet<String>>,
    upstream: Arc<HashMap<String, String>>,
    http: reqwest::Client,
    provider: &'static str,
    ws_id: Option<String>,
}

fn arg(name: &str) -> String {
    let mut args = std::env::args().skip(1);
    while let Some(key) = args.next() {
        if key == name {
            return args.next().unwrap_or_default();
        }
    }
    String::new()
}

fn host_of(value: &str) -> String {
    value
        .split(':')
        .next()
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

fn request_host(req: &Request<Body>) -> String {
    if let Some(host) = req.uri().host() {
        return host.to_ascii_lowercase();
    }
    req.headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        .map(host_of)
        .unwrap_or_default()
}

fn provider_for(host: &str) -> &'static str {
    match host {
        "chatgpt.com" => "codex",
        "api.openai.com" => "opencode",
        _ => "claude",
    }
}

fn content_type<T>(message: &hudsucker::hyper::http::HeaderMap<T>) -> String
where
    T: AsRef<[u8]>,
{
    message
        .get("content-type")
        .map(|value| String::from_utf8_lossy(value.as_ref()).to_ascii_lowercase())
        .unwrap_or_default()
}

fn refusal(status: StatusCode, host: &str, path: &str, cause: &str) -> Response<Body> {
    eprintln!("refus {} {host}{path} : {cause}", status.as_u16());
    let message = serde_json::json!({
        "error": { "type": "piecemaker_proxy", "message": format!("Relais d'anonymisation PieceMaker : {cause}.") }
    });
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(message.to_string()))
        .unwrap()
}

fn uri_path(uri: &Uri) -> String {
    match uri.path_and_query() {
        Some(path) if !path.as_str().is_empty() => path.as_str().to_string(),
        _ => "/".to_string(),
    }
}

async fn collect(body: Body) -> Result<Bytes, &'static str> {
    let bytes = body
        .collect()
        .await
        .map_err(|_| "corps illisible")?
        .to_bytes();
    if bytes.len() > MAX_BODY {
        return Err("corps trop volumineux");
    }
    Ok(bytes)
}

impl Handler {
    fn allowed(&self, host: &str) -> bool {
        self.hosts.contains(host)
    }

    fn intercepted_host(&self, uri: &Uri) -> Option<String> {
        let host = uri.host().map(str::to_ascii_lowercase).unwrap_or_default();
        if self.allowed(&host) {
            return Some(host);
        }
        let authority = uri.authority()?.as_str();
        self.upstream
            .iter()
            .find(|(_, dest)| dest.as_str() == authority)
            .map(|(host, _)| host.clone())
    }

    fn point_upstream(&self, host: &str, req: &mut Request<Body>) {
        let Some(dest) = self.upstream.get(host) else {
            return;
        };
        if let Ok(uri) = format!("http://{dest}{}", uri_path(req.uri())).parse() {
            *req.uri_mut() = uri;
        }
        if let Ok(value) = dest.parse() {
            req.headers_mut().insert("host", value);
        }
    }

    async fn rewrite(&self, path: &str, extra: &[(&str, &str)], body: Bytes) -> Result<Bytes, &'static str> {
        let mut request = self
            .http
            .post(format!("{}{path}", self.rewriter))
            .header("x-piecemaker-provider", self.provider)
            .body(body);
        for (name, value) in extra {
            request = request.header(*name, *value);
        }
        let response = request.send().await.map_err(|_| "réécrivain injoignable")?;
        if !response.status().is_success() {
            return Err("réécriture en échec");
        }
        response.bytes().await.map_err(|_| "réécriture interrompue")
    }

    async fn health(&self) -> Response<Body> {
        let alive = self
            .http
            .get(format!("{}/health", self.rewriter))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false);
        let (status, text) = if alive {
            (StatusCode::OK, format!("{{\"pid\":{},\"rewriter\":\"ok\"}}", std::process::id()))
        } else {
            (StatusCode::SERVICE_UNAVAILABLE, format!("{{\"pid\":{},\"rewriter\":\"down\"}}", std::process::id()))
        };
        Response::builder()
            .status(status)
            .header("content-type", "application/json")
            .body(Body::from(text))
            .unwrap()
    }

    fn spawn_sse(&self, body: Body) -> Body {
        let request = self
            .http
            .post(format!("{}/v1/sse", self.rewriter))
            .header("x-piecemaker-provider", self.provider);
        let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
        tokio::spawn(async move {
            let incoming = BodyStream::new(body).filter_map(|frame| async move {
                match frame {
                    Ok(frame) => frame.into_data().ok().map(Ok),
                    Err(error) => Some(Err(std::io::Error::other(error.to_string()))),
                }
            });
            match request.body(reqwest::Body::wrap_stream(incoming)).send().await {
                Ok(response) => {
                    let mut stream = response.bytes_stream();
                    while let Some(chunk) = stream.next().await {
                        if tx.send(chunk.map_err(std::io::Error::other)).await.is_err() {
                            break;
                        }
                    }
                }
                Err(error) => {
                    eprintln!("refus flux SSE : réécrivain injoignable");
                    let _ = tx.send(Err(std::io::Error::other(error))).await;
                }
            }
        });
        Body::from_stream(ReceiverStream::new(rx))
    }

    async fn rewrite_ws(&mut self, host: &str, outbound: bool, text: &str) -> Result<Option<Message>, &'static str> {
        let id = self
            .ws_id
            .get_or_insert_with(|| format!("ws-{}", WS_IDS.fetch_add(1, Ordering::Relaxed)))
            .clone();
        self.provider = provider_for(host);
        let direction = if outbound { "out" } else { "in" };
        let rewritten = self
            .rewrite(
                "/v1/ws",
                &[("x-piecemaker-ws", id.as_str()), ("x-piecemaker-direction", direction)],
                Bytes::from(text.to_string()),
            )
            .await?;
        if rewritten.is_empty() {
            return Ok(None);
        }
        Ok(Some(Message::Text(String::from_utf8_lossy(&rewritten).into_owned().into())))
    }

    async fn flush_ws(&self, host: &str) -> Vec<String> {
        let Some(id) = self.ws_id.clone() else {
            return Vec::new();
        };
        let mut handler = self.clone();
        handler.provider = provider_for(host);
        match handler
            .rewrite("/v1/ws-end", &[("x-piecemaker-ws", id.as_str())], Bytes::new())
            .await
        {
            Ok(tail) => pending_messages(&tail),
            Err(_) => Vec::new(),
        }
    }
}

impl HttpHandler for Handler {
    async fn should_intercept_connect(&mut self, _ctx: &HttpContext, req: &Request<Body>) -> bool {
        self.allowed(&request_host(req))
    }

    async fn should_intercept_tls(
        &mut self,
        _ctx: &HttpContext,
        client_hello: hudsucker::rustls::server::ClientHello<'_>,
    ) -> bool {
        client_hello
            .server_name()
            .map(|name| self.allowed(&name.to_ascii_lowercase()))
            .unwrap_or(false)
    }

    async fn handle_request(&mut self, _ctx: &HttpContext, req: Request<Body>) -> RequestOrResponse {
        let host = request_host(&req);
        if req.method() == Method::GET && req.uri().path() == "/health" && (host == "127.0.0.1" || host == "localhost") {
            return self.health().await.into();
        }
        if req.method() == Method::CONNECT || !self.allowed(&host) {
            return req.into();
        }
        self.provider = provider_for(&host);
        let path = uri_path(req.uri());

        let req = match decode_request(req) {
            Ok(req) => req,
            Err(_) => return refusal(StatusCode::UNSUPPORTED_MEDIA_TYPE, &host, &path, "encodage de corps inconnu").into(),
        };
        let kind = content_type(req.headers());
        let (mut parts, body) = req.into_parts();
        parts.headers.remove("accept-encoding");
        parts.headers.remove("sec-websocket-extensions");

        let collected = match collect(body).await {
            Ok(bytes) => bytes,
            Err(cause) => return refusal(StatusCode::BAD_GATEWAY, &host, &path, cause).into(),
        };
        let body = if collected.is_empty() {
            Body::empty()
        } else if kind.contains("json") {
            match self.rewrite("/v1/request", &[], collected).await {
                Ok(rewritten) => {
                    parts.headers.insert("content-length", rewritten.len().into());
                    Body::from(rewritten)
                }
                Err(cause) => return refusal(StatusCode::BAD_GATEWAY, &host, &path, cause).into(),
            }
        } else {
            return refusal(StatusCode::UNSUPPORTED_MEDIA_TYPE, &host, &path, "corps non JSON impossible à anonymiser").into();
        };

        let mut req = Request::from_parts(parts, body);
        self.point_upstream(&host, &mut req);
        req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let res = match decode_response(res) {
            Ok(res) => res,
            Err(_) => return refusal(StatusCode::BAD_GATEWAY, self.provider, "", "réponse compressée illisible"),
        };
        let kind = content_type(res.headers());
        let (mut parts, body) = res.into_parts();
        for name in ["content-encoding", "content-length", "transfer-encoding", "connection"] {
            parts.headers.remove(name);
        }

        if kind.contains("text/event-stream") {
            return Response::from_parts(parts, self.spawn_sse(body));
        }
        if !kind.contains("json") {
            return Response::from_parts(parts, body);
        }
        let rewritten = match collect(body).await {
            Ok(bytes) => self.rewrite("/v1/response", &[], bytes).await,
            Err(cause) => Err(cause),
        };
        match rewritten {
            Ok(bytes) => Response::from_parts(parts, Body::from(bytes)),
            Err(cause) => refusal(StatusCode::BAD_GATEWAY, self.provider, "", cause),
        }
    }
}

impl WebSocketHandler for Handler {
    async fn handle_websocket(
        mut self,
        ctx: WebSocketContext,
        mut stream: impl futures::Stream<Item = Result<Message, WsError>> + Unpin + Send + 'static,
        mut sink: impl futures::Sink<Message, Error = WsError> + Unpin + Send + 'static,
    ) {
        let (outbound, uri) = match &ctx {
            WebSocketContext::ClientToServer { dst, .. } => (true, dst),
            WebSocketContext::ServerToClient { src, .. } => (false, src),
        };
        let target = self.intercepted_host(uri);
        let intercepted = target.is_some();
        let host = target.unwrap_or_default();

        while let Some(Ok(message)) = stream.next().await {
            let frames = match (intercepted, message) {
                (false, message) => vec![message],
                (true, Message::Text(text)) => match self.rewrite_ws(&host, outbound, &text).await {
                    Ok(Some(message)) if outbound => vec![message],
                    Ok(Some(message)) => json_line_frames(message),
                    Ok(None) => continue,
                    Err(cause) => {
                        close_ws(&mut sink, &host, cause).await;
                        return;
                    }
                },
                (true, Message::Binary(_)) => {
                    close_ws(&mut sink, &host, "trame binaire impossible à anonymiser").await;
                    return;
                }
                (true, message) => vec![message],
            };
            for frame in frames {
                if sink.send(frame).await.is_err() {
                    return;
                }
            }
        }

        if intercepted && !outbound {
            for message in self.flush_ws(&host).await {
                if sink.send(Message::Text(message.into())).await.is_err() {
                    return;
                }
            }
        }
    }
}

async fn close_ws(sink: &mut (impl futures::Sink<Message, Error = WsError> + Unpin), host: &str, cause: &str) {
    eprintln!("refus websocket {host} : {cause}");
    let frame = CloseFrame {
        code: CloseCode::Error,
        reason: "PieceMaker: anonymisation impossible".into(),
    };
    let _ = sink.send(Message::Close(Some(frame))).await;
    let _ = sink.close().await;
}

fn json_line_frames(message: Message) -> Vec<Message> {
    let Message::Text(text) = &message else {
        return vec![message];
    };
    let lines: Vec<&str> = text.split('\n').filter(|line| !line.trim().is_empty()).collect();
    let every_line_is_json = lines.len() > 1
        && lines
            .iter()
            .all(|line| serde_json::from_str::<serde_json::Value>(line).is_ok());
    if !every_line_is_json {
        return vec![message];
    }
    lines
        .into_iter()
        .map(|line| Message::Text(line.to_string().into()))
        .collect()
}

fn pending_messages(bytes: &Bytes) -> Vec<String> {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|value| value.get("messages").and_then(|entry| entry.as_array()).cloned())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_list(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(host_of)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn parse_map(value: &str) -> HashMap<String, String> {
    value
        .split(',')
        .filter_map(|entry| {
            let (host, dest) = entry.split_once('=')?;
            let (host, dest) = (host_of(host), dest.trim().to_string());
            (!host.is_empty() && !dest.is_empty()).then_some((host, dest))
        })
        .collect()
}

fn exit_when_parent_dies() {
    std::thread::spawn(|| {
        let mut buffer = [0u8; 256];
        let mut stdin = std::io::stdin();
        loop {
            match stdin.read(&mut buffer) {
                Ok(0) | Err(_) => std::process::exit(0),
                Ok(_) => {}
            }
        }
    });
}

fn fail(message: String) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

#[tokio::main]
async fn main() {
    let listen = arg("--listen");
    let rewriter = arg("--rewriter");
    let ca_cert = arg("--ca-cert");
    let ca_key = arg("--ca-key");
    let hosts = parse_list(&arg("--hosts"));
    let upstream = parse_map(&arg("--upstream-map"));
    if listen.is_empty() || rewriter.is_empty() || ca_cert.is_empty() || ca_key.is_empty() || hosts.is_empty() {
        eprintln!("usage: piecemaker-hudsucker --listen 127.0.0.1:0 --rewriter http://127.0.0.1:port --ca-cert ca.crt --ca-key ca.key --hosts api.anthropic.com,api.openai.com,chatgpt.com");
        std::process::exit(2);
    }
    exit_when_parent_dies();

    let key = std::fs::read_to_string(&ca_key).unwrap_or_else(|error| fail(format!("clé d'autorité illisible : {error}")));
    let cert = std::fs::read_to_string(&ca_cert).unwrap_or_else(|error| fail(format!("certificat d'autorité illisible : {error}")));
    let key_pair = KeyPair::from_pem(&key).unwrap_or_else(|error| fail(format!("clé d'autorité refusée : {error}")));
    let issuer = Issuer::from_ca_cert_pem(&cert, key_pair).unwrap_or_else(|error| fail(format!("certificat d'autorité refusé : {error}")));
    let authority = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());
    let addr: SocketAddr = listen.parse().unwrap_or_else(|_| fail("adresse d'écoute invalide".into()));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|error| fail(format!("écoute impossible sur {addr} : {error}")));
    let bound = listener.local_addr().unwrap_or_else(|error| fail(format!("adresse d'écoute inconnue : {error}")));
    let http = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_else(|error| fail(format!("client interne : {error}")));
    let handler = Handler {
        rewriter,
        hosts: Arc::new(hosts),
        upstream: Arc::new(upstream),
        http,
        provider: "claude",
        ws_id: None,
    };
    let proxy = Proxy::builder()
        .with_listener(listener)
        .with_ca(authority)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler.clone())
        .with_websocket_handler(handler)
        .build()
        .unwrap_or_else(|error| fail(format!("proxy : {error}")));
    println!("listening {bound}");
    if let Err(error) = proxy.start().await {
        fail(format!("proxy arrêté : {error}"));
    }
}
