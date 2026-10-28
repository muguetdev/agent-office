# command-express/machine — one AI agent's desktop computer.
#
# Base: linuxserver.io webtop (Ubuntu + XFCE), which serves a Selkies web
# desktop on port 3000 through nginx. The image's SUBFOLDER env var moves the
# whole web UI (page + /api websocket) under a path prefix, e.g.
# SUBFOLDER=/api/machines/<id>/desktop/.
#
# Added on top:
#   - Google Chrome stable, started with the desktop by an s6 service
#     (rootfs/etc/s6-overlay/s6-rc.d/svc-chrome) and restarted if closed,
#     with DevTools on 127.0.0.1:9222 inside the container;
#   - socat relaying DevTools to 0.0.0.0:9223 (svc-cdp-proxy) so the host can
#     publish it (the host binds it to 127.0.0.1 only);
#   - developer tools: git, curl, build-essential, Python 3 + pip + venv,
#     Node.js LTS (NodeSource) + npm, VS Code;
#   - pt_BR.UTF-8 + en_US.UTF-8 locales and Noto fonts (incl. colour emoji).
#
# Build:  docker build -t command-express/machine:latest .
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Node.js major line taken from NodeSource (an LTS line).
ARG NODE_MAJOR=24
# Default desktop language; can be overridden per container with -e LANG=...
ARG DEFAULT_LANG=pt_BR.UTF-8
ARG DEFAULT_LANGUAGE=pt_BR:pt:en

ARG DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential \
      python3 python3-pip python3-venv \
      socat locales \
      fonts-noto-core fonts-noto-ui-core fonts-noto-mono fonts-noto-color-emoji; \
    # Locales
    sed -i -e 's/^# *\(pt_BR.UTF-8 UTF-8\)/\1/' -e 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen; \
    locale-gen; \
    # Third-party apt repositories (keys in /etc/apt/keyrings)
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg; \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list; \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg; \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
      > /etc/apt/sources.list.d/vscode.list; \
    # The base image ships its own NodeSource entry (another major); replace it.
    rm -f /etc/apt/sources.list.d/nodesource.sources /usr/share/keyrings/nodesource.gpg; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list; \
    # Keep the VS Code package from adding a second, conflicting repo entry.
    echo "code code/add-microsoft-repo boolean false" | debconf-set-selections; \
    apt-get update; \
    apt-get install -y --no-install-recommends google-chrome-stable code nodejs; \
    # Chrome's postinst may (re)write its own list file; make sure only one
    # Chrome entry remains so `apt-get update` keeps working inside machines.
    rm -f /etc/apt/sources.list.d/google-chrome.sources; \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list; \
    apt-get update; \
    # Sanity checks
    google-chrome --version; node --version; npm --version; \
    code --version --no-sandbox --user-data-dir=/tmp/code-check >/dev/null 2>&1 || true; \
    python3 --version; git --version; socat -V | head -1; \
    # Clean up
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/tmp/* /tmp/*

ENV LANG=${DEFAULT_LANG} \
    LANGUAGE=${DEFAULT_LANGUAGE}

# s6 services: svc-chrome (Chrome + restart loop) and svc-cdp-proxy (socat).
COPY rootfs/ /

# 3000 = web desktop (HTTP + websocket under SUBFOLDER), 9223 = Chrome DevTools.
EXPOSE 3000 9223
