# PurpleInk Proxy

Start the browser with `npm start`. Regular websites use the built-in Wisp proxy.

To browse `.onion` links, run a Tor daemon on the same host as this app and make
its SOCKS5 listener available at `127.0.0.1:9050` (the default). For a different
listener, set `TOR_SOCKS_HOST` and `TOR_SOCKS_PORT` before starting the app.
Onion traffic is sent through that SOCKS5 listener; ordinary web traffic keeps
using the direct Wisp connection.
