use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use futures::StreamExt;
use http_body_util::{BodyExt, BodyStream};
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::hyper::{Request, Response, StatusCode, Uri};
use hudsucker::rcgen::{Issuer, KeyPair};
use hudsucker::rustls::crypto::aws_lc_rs;
use hudsucker::tokio_tungstenite::tungstenite::Message;
use hudsucker::{
    Body, HttpContext, HttpHandler, Proxy, RequestOrResponse, WebSocketContext, WebSocketHandler,
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
    provider: String,
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
    if let Some(authority) = req.uri().authority() {
        return authority.host().to_ascii_lowercase();
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

fn header_text(req: &Request<Body>, name: &str) -> String {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn response_type(res: &Response<Body>) -> String {
    res.headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_json(value: &str) -> bool {
    value.contains("json")
}

fn is_sse(value: &str) -> bool {
    value.contains("text/event-stream")
}

fn health_request(req: &Request<Body>) -> bool {
    let host = request_host(req);
    req.method() == hudsucker::hyper::Method::GET
        && (req.uri().path() == "/" || req.uri().path().is_empty())
        && (host.is_empty() || host == "127.0.0.1" || host == "localhost")
}

fn failure() -> Response<Body> {
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header("content-type", "application/json")
        .body(Body::from(
            "{\"error\":{\"type\":\"piecemaker_proxy\",\"message\":\"Relais d'anonymisation indisponible.\"}}",
        ))
        .unwrap()
}

fn uri_path(uri: &Uri) -> String {
    match uri.path_and_query() {
        Some(path) if !path.as_str().is_empty() => path.as_str().to_string(),
        _ => "/".to_string(),
    }
}

impl Handler {
    fn allowed(&self, host: &str) -> bool {
        self.hosts.contains(host)
    }

    fn point_upstream(&self, host: &str, req: &mut Request<Body>) {
        let Some(dest) = self.upstream.get(host) else {
            return;
        };
        let path = uri_path(req.uri());
        let rewritten = format!("http://{dest}{path}");
        if let Ok(uri) = rewritten.parse() {
            *req.uri_mut() = uri;
        }
        if let Ok(value) = dest.parse() {
            req.headers_mut().insert("host", value);
        }
    }

    async fn post_bytes(&self, path: &str, provider: &str, extra: &[(&str, &str)], body: Bytes) -> Result<Bytes, ()> {
        let mut request = self
            .http
            .post(format!("{}{path}", self.rewriter))
            .header("x-piecemaker-provider", provider)
            .body(body);
        for (name, value) in extra {
            request = request.header(*name, *value);
        }
        let response = request.send().await.map_err(|_| ())?;
        if !response.status().is_success() {
            return Err(());
        }
        response.bytes().await.map_err(|_| ())
    }

    fn spawn_sse(&self, provider: String, body: Body) -> Body {
        let http = self.http.clone();
        let url = format!("{}/v1/sse", self.rewriter);
        let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
        tokio::spawn(async move {
            let incoming = BodyStream::new(body).filter_map(|frame| async move {
                match frame {
                    Ok(frame) => frame.into_data().ok().map(Ok),
                    Err(error) => Some(Err(std::io::Error::other(error.to_string()))),
                }
            });
            let sent = http
                .post(url)
                .header("x-piecemaker-provider", provider)
                .body(reqwest::Body::wrap_stream(incoming))
                .send()
                .await;
            match sent {
                Ok(response) => {
                    let mut stream = response.bytes_stream();
                    while let Some(chunk) = stream.next().await {
                        let mapped = chunk.map_err(|error| std::io::Error::other(error.to_string()));
                        if tx.send(mapped).await.is_err() {
                            break;
                        }
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(std::io::Error::other(error.to_string()))).await;
                }
            }
        });
        Body::from_stream(ReceiverStream::new(rx))
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
        if health_request(&req) {
            return Response::builder()
                .status(StatusCode::OK)
                .body(Body::from("ok"))
                .unwrap()
                .into();
        }

        if req.method() == hudsucker::hyper::Method::CONNECT {
            return req.into();
        }

        let host = request_host(&req);
        if !self.allowed(&host) {
            return req.into();
        }
        self.provider = provider_for(&host).to_string();

        let content_type = header_text(&req, "content-type");
        let (mut parts, body) = req.into_parts();
        parts.headers.remove("accept-encoding");
        parts.headers.remove("sec-websocket-extensions");

        let body = if is_json(&content_type.to_ascii_lowercase()) {
            let collected = match body.collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(_) => return failure().into(),
            };
            if collected.len() > MAX_BODY {
                return failure().into();
            }
            if collected.is_empty() {
                Body::empty()
            } else {
                match self
                    .post_bytes("/v1/request", &self.provider.clone(), &[], collected)
                    .await
                {
                    Ok(rewritten) => {
                        if let Ok(length) = rewritten.len().to_string().parse() {
                            parts.headers.insert("content-length", length);
                        }
                        Body::from(rewritten)
                    }
                    Err(_) => return failure().into(),
                }
            }
        } else {
            body
        };

        let mut req = Request::from_parts(parts, body);
        self.point_upstream(&host, &mut req);
        req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let kind = response_type(&res);
        let provider = self.provider.clone();
        let (mut parts, body) = res.into_parts();
        parts.headers.remove("content-encoding");
        parts.headers.remove("content-length");
        parts.headers.remove("transfer-encoding");
        parts.headers.remove("connection");

        if is_sse(&kind) {
            parts.headers.remove("content-length");
            parts.headers.insert(
                "content-type",
                "text/event-stream".parse().unwrap(),
            );
            return Response::from_parts(parts, self.spawn_sse(provider, body));
        }

        if is_json(&kind) {
            let collected = match body.collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(_) => return failure(),
            };
            if collected.len() > MAX_BODY {
                return failure();
            }
            let rewritten = match self.post_bytes("/v1/response", &provider, &[], collected).await {
                Ok(rewritten) => rewritten,
                Err(_) => return failure(),
            };
            return Response::from_parts(parts, Body::from(rewritten));
        }

        Response::from_parts(parts, body)
    }
}

impl WebSocketHandler for Handler {
    async fn handle_message(&mut self, ctx: &WebSocketContext, message: Message) -> Option<Message> {
        let (outbound, uri) = match ctx {
            WebSocketContext::ClientToServer { dst, .. } => (true, dst),
            WebSocketContext::ServerToClient { src, .. } => (false, src),
        };
        let host = uri.host().map(|value| value.to_ascii_lowercase()).unwrap_or_default();
        if !self.allowed(&host) {
            return Some(message);
        }
        let Message::Text(text) = message else {
            return Some(message);
        };
        if self.ws_id.is_none() {
            self.ws_id = Some(format!("ws-{}", WS_IDS.fetch_add(1, Ordering::Relaxed)));
        }
        let id = self.ws_id.clone().unwrap_or_default();
        let direction = if outbound { "out" } else { "in" };
        let provider = provider_for(&host);
        match self
            .post_bytes(
                "/v1/ws",
                provider,
                &[
                    ("x-piecemaker-ws", id.as_str()),
                    ("x-piecemaker-direction", direction),
                ],
                Bytes::from(text.to_string()),
            )
            .await
        {
            Ok(rewritten) if !rewritten.is_empty() => {
                Some(Message::Text(String::from_utf8_lossy(&rewritten).into_owned().into()))
            }
            Ok(_) => None,
            Err(_) => None,
        }
    }

    async fn handle_websocket(
        mut self,
        ctx: WebSocketContext,
        mut stream: impl futures::Stream<Item = Result<Message, hudsucker::tokio_tungstenite::tungstenite::Error>>
            + Unpin
            + Send
            + 'static,
        mut sink: impl futures::Sink<Message, Error = hudsucker::tokio_tungstenite::tungstenite::Error>
            + Unpin
            + Send
            + 'static,
    ) {
        use futures::SinkExt;
        while let Some(message) = stream.next().await {
            match message {
                Ok(message) => {
                    let Some(message) = self.handle_message(&ctx, message).await else {
                        continue;
                    };
                    let frames = match &ctx {
                        WebSocketContext::ServerToClient { .. } => json_line_frames(message),
                        WebSocketContext::ClientToServer { .. } => vec![message],
                    };
                    let mut closed = false;
                    for frame in frames {
                        if sink.send(frame).await.is_err() {
                            closed = true;
                            break;
                        }
                    }
                    if closed {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(id) = self.ws_id.clone() {
            let host = match &ctx {
                WebSocketContext::ClientToServer { dst, .. } => dst.host().unwrap_or_default().to_string(),
                WebSocketContext::ServerToClient { src, .. } => src.host().unwrap_or_default().to_string(),
            };
            if let Ok(tail) = self
                .post_bytes(
                    "/v1/ws-end",
                    provider_for(&host_of(&host)),
                    &[("x-piecemaker-ws", id.as_str())],
                    Bytes::new(),
                )
                .await
            {
                if let Ok(messages) = serde_json_messages(&tail) {
                    for message in messages {
                        if sink.send(Message::Text(message.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }
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

fn serde_json_messages(bytes: &Bytes) -> Result<Vec<String>, ()> {
    let text = std::str::from_utf8(bytes).map_err(|_| ())?;
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| ())?;
    Ok(value
        .get("messages")
        .and_then(|entry| entry.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

fn parse_list(value: &str) -> HashSet<String> {
    value
        .split(',')
        .map(|entry| host_of(entry.trim()))
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn parse_map(value: &str) -> HashMap<String, String> {
    value
        .split(',')
        .filter_map(|entry| {
            let (host, dest) = entry.split_once('=')?;
            let host = host_of(host.trim());
            let dest = dest.trim().to_string();
            if host.is_empty() || dest.is_empty() {
                None
            } else {
                Some((host, dest))
            }
        })
        .collect()
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
        eprintln!("usage: piecemaker-hudsucker --listen 127.0.0.1:4111 --rewriter http://127.0.0.1:port --ca-cert ca.crt --ca-key ca.key --hosts api.anthropic.com,api.openai.com,chatgpt.com");
        std::process::exit(2);
    }

    let key = std::fs::read_to_string(&ca_key).unwrap_or_else(|error| {
        eprintln!("clé d'autorité illisible : {error}");
        std::process::exit(1);
    });
    let cert = std::fs::read_to_string(&ca_cert).unwrap_or_else(|error| {
        eprintln!("certificat d'autorité illisible : {error}");
        std::process::exit(1);
    });
    let key_pair = KeyPair::from_pem(&key).unwrap_or_else(|error| {
        eprintln!("clé d'autorité refusée : {error}");
        std::process::exit(1);
    });
    let issuer = Issuer::from_ca_cert_pem(&cert, key_pair).unwrap_or_else(|error| {
        eprintln!("certificat d'autorité refusé : {error}");
        std::process::exit(1);
    });
    let authority = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());
    let addr: SocketAddr = listen.parse().unwrap_or_else(|_| {
        eprintln!("adresse d'écoute invalide");
        std::process::exit(2);
    });
    let http = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap_or_else(|error| {
            eprintln!("client interne : {error}");
            std::process::exit(1);
        });
    let handler = Handler {
        rewriter,
        hosts: Arc::new(hosts),
        upstream: Arc::new(upstream),
        http,
        provider: "claude".to_string(),
        ws_id: None,
    };
    println!("listening {addr}");
    let proxy = match Proxy::builder()
        .with_addr(addr)
        .with_ca(authority)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler.clone())
        .with_websocket_handler(handler)
        .build()
    {
        Ok(proxy) => proxy,
        Err(error) => {
            eprintln!("proxy : {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = proxy.start().await {
        eprintln!("proxy arrêté : {error}");
        std::process::exit(1);
    }
}
