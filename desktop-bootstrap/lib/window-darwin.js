ObjC.import('Cocoa');
ObjC.import('WebKit');

ObjC.registerSubclass({
  name: 'PieceMakerInstallerWindowDelegate',
  protocols: ['NSWindowDelegate'],
  methods: {
    'windowWillClose:': {
      types: ['void', ['id']],
      implementation: function () {
        $.NSApplication.sharedApplication.terminate(null);
      },
    },
  },
});

function menuItem(title, action, key) {
  return $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, action, key);
}

function submenu(title, items) {
  const holder = $.NSMenuItem.alloc.init;
  const menu = $.NSMenu.alloc.initWithTitle(title);
  items.forEach((item) => menu.addItem(item));
  holder.submenu = menu;
  return holder;
}

function installMenu(app) {
  const bar = $.NSMenu.alloc.init;
  bar.addItem(submenu('PieceMaker', [menuItem('Fermer la fenêtre', 'terminate:', 'q')]));
  bar.addItem(submenu('Édition', [
    menuItem('Annuler', 'undo:', 'z'),
    menuItem('Couper', 'cut:', 'x'),
    menuItem('Copier', 'copy:', 'c'),
    menuItem('Coller', 'paste:', 'v'),
    menuItem('Tout sélectionner', 'selectAll:', 'a'),
  ]));
  app.mainMenu = bar;
}

function run(argv) {
  const [url, width, height] = argv;
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  installMenu(app);

  const frame = $.NSMakeRect(0, 0, Number(width), Number(height));
  const style = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable | $.NSWindowStyleMaskMiniaturizable | $.NSWindowStyleMaskResizable;
  const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(frame, style, $.NSBackingStoreBuffered, false);
  window.title = 'Installation de PieceMaker';
  window.releasedWhenClosed = false;
  window.delegate = $.PieceMakerInstallerWindowDelegate.alloc.init;

  const webView = $.WKWebView.alloc.initWithFrameConfiguration(frame, $.WKWebViewConfiguration.alloc.init);
  window.contentView = webView;
  webView.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(url)));

  window.center;
  window.makeKeyAndOrderFront(null);
  app.activateIgnoringOtherApps(true);
  app.run;
}
