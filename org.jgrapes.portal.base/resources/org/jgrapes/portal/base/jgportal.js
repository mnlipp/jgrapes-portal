/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2016, 2019  Michael N. Lipp
 *
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Affero General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License 
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/**
 * JGPortal establishes a namespace for the JavaScript functions
 * that are provided by the portal.
 * 
 * @module portal-base-resource/jgportal
 */
 
/** The exported class used to access everything. */
export class JGPortal {};
export default JGPortal;

// For backward compatibility
window.JGPortal = JGPortal;

/**
 * Easy access to logging.
 */
JGPortal.Log = class Log {

    /**
     * Output a debug message.
     * @param {string} message the message to print
     */
    static debug (message) {
        if (console && console.debug) {
            console.debug(message)
        }
    }
    
    /**
     * Output an info message.
     * @param {string} message the message to print
     */
    static info(message) {
        if (console && console.info) {
            console.info(message)
        }
    }
    
    /**
     * Output a warn message.
     * @param {string} message the message to print
     */
    static warn(message) {
        if (console && console.warn) {
            console.warn(message)
        }
    }
    
    /**
     * Output an error message.
     * @param {string} message the message to print
     */
    static error(message) {
        if (console && console.error) {
            console.error(message)
        }
    }
};

// For Backward compatibility
JGPortal.log = JGPortal.Log;
// Local access
var log = JGPortal.Log;

// ///////////////////
// WebSocket "wrapper"
// ///////////////////

/**
 * Defines a wrapper class for a web socket. An instance 
 * creates and maintains a connection to a session on the
 * server, i.e. it reconnects automatically to the session
 * when the connection is lost. The connection is used to
 * exchange JSON RPC notifications.
 */
class PortalWebSocket {

    constructor(portal) {
        // "Privacy by convention" is sufficient for this.
        this._debugHandler = false;
        this._portal = portal;
        this._ws = null;
        this._sendQueue = [];
        this._recvQueue = [];
        this._recvQueueLocks = 0;
        this._messageHandlers = {};
        this._refreshTimer = null;
        this._inactivity = 0;
        this._reconnectTimer = null;
        this._connectRequested = false;
        this._initialConnect = true;
        this._portalSessionId = null;
        this._connectionLost = false;
        this._oldPortalSessionId = sessionStorage.getItem("org.jgrapes.portal.base.sessionId");
    };

    /**
     * Returns the unique session id used to identify the connection.
     * 
     * @return {string} the id
     */
    portalSessionId() {
        return this._portalSessionId;
    }

    _connect() {
        let location = (window.location.protocol === "https:" ? "wss" : "ws") +
            "://" + window.location.host + window.location.pathname;
        if (!location.endsWith("/")) {
            location += "/";
        }
        this._portalSessionId = sessionStorage.getItem("org.jgrapes.portal.base.sessionId");
        location += "portal-session/" + this._portalSessionId;
        if (this._oldPortalSessionId) {
            location += "?was=" + this._oldPortalSessionId;
            this._oldPortalSessionId = null;
        }
        log.debug("Creating WebSocket for " + location);
        this._ws = new WebSocket(location);
        log.debug("Created WebSocket with readyState " + this._ws.readyState);
        let self = this;
        this._ws.onopen = function() {
            log.debug("OnOpen called for WebSocket.");
            if (self._connectionLost) {
                self._connectionLost = false;
                self._portal.connectionRestored();
            }
            self._drainSendQueue();
            if (self._initialConnect) {
                self._initialConnect = false;
            } else {
                // Make sure to get any lost updates
                let renderer = self._portal._renderer;
                renderer.findPreviewIds().forEach(function(id) {
                    renderer.sendRenderPortlet(id, ["Preview"]);
                });
                renderer.findViewIds().forEach(function(id) {
                    renderer.sendRenderPortlet(id, ["View"]);
                });
            }
            self._refreshTimer = setInterval(function() {
                if (self._sendQueue.length == 0) {
                    self._inactivity += self._portal.sessionRefreshInterval;
                    if (self._portal.sessionInactivityTimeout > 0 &&
                        self._inactivity >= self._portal.sessionInactivityTimeout) {
                        self.close();
                        self._portal.connectionSuspended(function() {
                            self.connect();
                        });
                        return;
                    }
                    self._send({
                        "jsonrpc": "2.0", "method": "keepAlive",
                        "params": []
                    });
                }
            }, self._portal.sessionRefreshInterval);
        }
        this._ws.onclose = function(event) {
            log.debug("OnClose called for WebSocket (reconnect: " +
                self._connectRequested + ").");
            if (self._refreshTimer !== null) {
                clearInterval(self._refreshTimer);
                self._refreshTimer = null;
            }
            if (self._connectRequested) {
                // Not an intended disconnect
                if (!self._connectionLost) {
                    self._portal.connectionLost();
                    self._connectionLost = true;
                }
                self._initiateReconnect();
            }
        }
        // "onClose" is called even if the initial connection fails,
        // so we don't need "onError".
        // this._ws.onerror = function(event) {
        // }
        this._ws.onmessage = function(event) {
            var msg;
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                log.error(e.name + ":" + e.lineNumber + ":" + e.columnNumber
                    + ": " + e.message + ". Data: ");
                log.error(event.data);
                return;
            }
            self._recvQueue.push(msg);
            if (self._recvQueue.length === 1) {
                self._handleMessages();
            }
        }
    }

    /**
     * Establishes the connection.
     */
    connect() {
        this._connectRequested = true;
        let self = this;
        $(window).on('beforeunload', function() {
            log.debug("Closing WebSocket due to page unload");
            // Internal connect, don't send disconnect
            self._connectRequested = false;
            self._ws.close();
        });
        this._connect();
    }

    /**
     * Closes the connection.
     */
    close() {
        if (this._portalSessionId) {
            this._send({
                "jsonrpc": "2.0", "method": "disconnect",
                "params": [this._portalSessionId]
            });
        }
        this._connectRequested = false;
        this._ws.close();
    }

    _initiateReconnect() {
        if (!this._reconnectTimer) {
            let self = this;
            this._reconnectTimer = setTimeout(function() {
                self._reconnectTimer = null;
                self._connect();
            }, 1000);
        }
    }

    _drainSendQueue() {
        while (this._ws.readyState == this._ws.OPEN && this._sendQueue.length > 0) {
            let msg = this._sendQueue[0];
            try {
                this._ws.send(msg);
                this._sendQueue.shift();
            } catch (e) {
                log.warn(e);
            }
        }
    }

    _send(data) {
        this._sendQueue.push(JSON.stringify(data));
        this._drainSendQueue();
    }

    /**
     * Convert the passed object to its JSON representation
     * and sends it to the server. The object should represent
     * a JSON RPC notification.
     * 
     * @param  {Object} data the data
     */
    send(data) {
        this._inactivity = 0;
        this._send(data);
    }

    /**
     * When a JSON RPC notification is received, its method property
     * is matched against all added handlers. If a match is found,
     * the associated handler function is invoked with the
     * params values from the notification as parameters.
     * 
     * @param {string} method the method property to match
     * @param {function} handler the handler function
     */
    addMessageHandler(method, handler) {
        this._messageHandlers[method] = handler;
    }

    _handlerLog(msgSup) {
        if (this._debugHandler) {
            log.debug(msgSup());
        }
    }

    _handleMessages() {
        while (true) {
            if (this._recvQueueLocks > 0) {
                this._handlerLog(() => "Handler receive queue locked.");
                break;
            }
            if (this._recvQueue.length === 0) {
                this._handlerLog(() => "Handler receive queue empty.");
                break;
            }
            var message = this._recvQueue.shift();
            var handler = this._messageHandlers[message.method];
            if (!handler) {
                log.error("No handler for invoked method " + message.method);
                continue;
            }
            if (message.hasOwnProperty("params")) {
                this._handlerLog(() => "Handling: " + message.method
                    + "[" + message.params + "]");
                handler(...message.params);
            } else {
                this._handlerLog(() => "Handling: " + message.method);
                handler();
            }
        }
    }

    lockMessageReceiver() {
        this._recvQueueLocks += 1;
        if (this._debugHandler) {
            try {
                throw new Error("Lock");
            } catch (exc) {
                log.debug("Locking receiver:\n" + exc.stack);
            }
        }
    }

    unlockMessageReceiver() {
        this._recvQueueLocks -= 1;
        if (this._debugHandler) {
            try {
                throw new Error("Unlock");
            } catch (exc) {
                log.debug("Unlocking receiver:\n" + exc.stack);
            }
        }
        if (this._recvQueueLocks == 0) {
            this._handleMessages();
        }
    }
}

class ResourceManager {

    constructor(portal, providedResources) {
        this._portal = portal;
        this._debugLoading = false;
        this._providedScriptResources = new Set(providedResources); // Names, i.e. strings
        this._unresolvedScriptRequests = []; // ScriptResource objects
        this._loadingScripts = new Set(); // uris (src attribute)
        this._unlockMessageQueueAfterLoad = false;
        this._loadingTimeoutHandler = null;
        this._scriptResourceSnippet = 0;
    }

    _loadingMsg(msg) {
        if (this._debugLoading) {
            log.debug(moment().format("HH:mm:ss.SSS") + ": " + msg());
        }
    }

    _mayBeStartScriptLoad(scriptResource) {
        let self = this;
        if (self._debugLoading) {
            if (scriptResource.provides.length > 0) {
                scriptResource.id = scriptResource.provides.join("/");
            } else if (scriptResource.uri) {
                scriptResource.id = scriptResource.uri;
            } else {
                scriptResource.id = "Snippet_" + ++this._scriptResourceSnippet;
            }
        }
        let stillRequired = scriptResource.requires;
        scriptResource.requires = [];
        stillRequired.forEach(function(required) {
            if (!self._providedScriptResources.has(required)) {
                scriptResource.requires.push(required);
            }
        });
        if (scriptResource.requires.length > 0) {
            self._loadingMsg(function() {
                return "Not (yet) loading: " + scriptResource.id
                    + ", missing: " + scriptResource.requires.join(", ")
            });
            self._unresolvedScriptRequests.push(scriptResource);
            return;
        }
        this._startScriptLoad(scriptResource);
    }

    _startScriptLoad(scriptResource) {
        let self = this;
        let head = $("head").get()[0];
        let script = document.createElement("script");
        if (scriptResource.id) {
            script.setAttribute("id", scriptResource.id);
        }
        if (scriptResource.type) {
            script.setAttribute("type", scriptResource.type);
        }
        if (scriptResource.source) {
            // Script source is part of request, add and proceed as if loaded.
            script.text = scriptResource.source;
            head.appendChild(script);
            self._scriptResourceLoaded(scriptResource);
            return;
        }
        if (!scriptResource.uri) {
            return;
        }
        // Asynchronous loading.
        script.src = scriptResource.uri;
        script.addEventListener('load', function(event) {
            // Remove this from loading
            self._loadingScripts.delete(script.src);
            self._scriptResourceLoaded(scriptResource);
        });
        // Put on script load queue to indicate load in progress
        self._loadingMsg(function() { return "Loading: " + scriptResource.id });
        self._loadingScripts.add(script.src);
        if (this._loadingTimeoutHandler === null) {
            this._loadingTimeoutHandler = setInterval(
                function() {
                    log.warn("Still waiting for: "
                        + Array.from(self._loadingScripts).join(", "));
                }, 5000)
        }
        head.appendChild(script);
    }

    _scriptResourceLoaded(scriptResource) {
        let self = this;
        // Whatever it provides is now provided
        this._loadingMsg(function() { return "Loaded: " + scriptResource.id });
        scriptResource.provides.forEach(function(res) {
            self._providedScriptResources.add(res);
        });
        // Re-evaluate
        let nowProvided = new Set(scriptResource.provides);
        let stillUnresolved = self._unresolvedScriptRequests;
        self._unresolvedScriptRequests = [];
        stillUnresolved.forEach(function(reqRes) {
            // Still required by this unresolved resource
            let stillRequired = reqRes.requires;
            reqRes.requires = []; // Accumulates new value
            stillRequired.forEach(function(required) {
                if (!nowProvided.has(required)) {
                    // Not in newly provided, still required
                    reqRes.requires.push(required);
                }
            });
            if (reqRes.requires.length == 0) {
                self._startScriptLoad(reqRes);
            } else {
                // Back to still unresolved
                self._unresolvedScriptRequests.push(reqRes);
            }
        });
        // All done?
        if (self._loadingScripts.size == 0) {
            if (this._loadingTimeoutHandler !== null) {
                clearInterval(this._loadingTimeoutHandler);
                this._loadingTimeoutHandler = null;
            }
            if (self._unlockMessageQueueAfterLoad) {
                self._loadingMsg(function() { return "All loaded, unlocking message queue." });
                self._portal.unlockMessageQueue();
            }
        }
    }

    addPageResources(cssUris, cssSource, scriptResources) {
        for (let index in cssUris) {
            let uri = cssUris[index];
            if ($("head > link[href='" + uri + "']").length === 0) {
                $("head link[rel='stylesheet']:last").after("<link rel='stylesheet' href='" + uri + "'>");
            }
        }
        if (cssSource) {
            let style = $("style");
            style.text(cssSource);
            $("head link[rel='stylesheet']:last").after(style);
        }
        // Don't use jquery, https://stackoverflow.com/questions/610995/cant-append-script-element
        for (let index in scriptResources) {
            let scriptResource = scriptResources[index];
            if (scriptResource.uri) {
                if ($("head > script[src='" + scriptResource.uri + "']").length > 0) {
                    continue;
                }
            }
            this._mayBeStartScriptLoad(scriptResource);
        }
    }

    lockWhileLoading() {
        if (this._loadingScripts.size > 0 && !this._unlockMessageQueueAfterLoad) {
            this._portal.lockMessageQueue();
            this._loadingMsg(function() { return "Locking message queue until all loaded." });
            this._unlockMessageQueueAfterLoad = true;
        }
    }
}

/**
 * A base class for implementing a portral renderer. The renderer
 * provides the DOM, based on the initial DOM from the portal page.
 */
JGPortal.Renderer = class {

    init() {
    }

    /**
     * Provides access to the portal instance.
     *
     * @return {Portal} the portal
     */
    portal() {
        return thePortal;
    }

    /**
     * Called from the portal when the connection to the server is lost.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a notification.
     */
    connectionLost() {
        log.warn("Connection lost notification not implemented!");
    }

    /**
     * Called from the portal when the connection to the server is restored.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a notification.
     */
    connectionRestored() {
        log.warn("Connection restored notification not implemented!");
    }

    /**
     * Called from the portal when the connection to the server is syspended.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a modal dialog.
     */
    connectionSuspended(resume) {
        log.warn("Connection suspended dialog not implemented!");
    }

    /**
     * Called from the portal when the portal is configured.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a modal dialog.
     */
    portalConfigured() {
        log.warn("Portal configured handling not implemented!");
    }

    /**
     * Called from the portal when a new portlet type is been added.
     * @param {string} portletType the portlet type
     * @param {Object} displayNames the display names by lang
     * @param {Array.string} renderModes the render modes
     */
    addPortletType(portletType, displayNames, renderModes) {
        log.warn("Not implemented!");
    }

    /**
     * Called from the portal when the portal layout is received.
     *
     * @param {string[]} previewLayout the portlet ids from top left
     * to bottom right
     * @param {string[]} tabsLayout the ids of the portlets viewable in tabs
     * @param {Object} xtraInfo extra information spcific to the 
     * portal implementation
     */
    lastPortalLayout(previewLayout, tabsLayout, xtraInfo) {
        log.warn("Not implemented!");
    }

    /**
     * Update the preview of the given portlet.
     *
     * @param {boolean} isNew `true` if it is a new portlet preview
     * @param {HTMLElement} container the container for the preview,
     * provided as:
     * ```
     * <section class='portlet portlet-preview' data-portlet-id='...' 
     *      data-portlet-grid-columns='...' data-portlet-grid-rows='   '></section>
     * ```
     * @param {string[]} modes the supported portlet modes
     * @param {string} content the preview content
     * @param {boolean} foreground `true` if the preview (i.e. the overview
     * plane) is to be made the active tab
     */
    updatePortletPreview(isNew, container, modes, content, foreground) {
        log.warn("Not implemented!");
    }

    /**
     * Update the view of the given portlet.
     *
     * @param {boolean} isNew `true` if it is a new portlet view
     * @param {HTMLElement} container the container for the view,
     * provided as:
     * ```
     * <article class="portlet portlet-view portlet-content 
     *          data-portlet-id='...'"></article>"
     * ```
     * @param {string[]} modes the supported portlet modes
     * @param {string} content the view content
     * @param {boolean} foreground `true` if the view 
     * is to be made the active tab
     */
    updatePortletView(isNew, container, modes, content, foreground) {
        log.warn("Not implemented!");
    }

    /**
     * Remove the given portlet representations, which may be 
     * preview or view containers, from the DOM.
     *
     * @param {NodeList} containers the existing containers for
     * the preview or views 
     */
    removePortletDisplays(containers) {
        log.warn("Not implemented!");
    }

    /**
     * Update the title of the portlet with the given id.
     *
     * @param {string} portletId the portlet id
     * @param {string} title the new title
     */
    updatePortletTitle(portletId, title) {
        log.warn("Not implemented!");
    }

    /**
     * Update the modes of the portlet with the given id.
     * 
     * @param {string} portletId the portlet id
     * @param {string[]} modes the modes
     */
    updatePortletModes(portletId, modes) {
        log.warn("Not implemented!");
    }

    showEditDialog(container, modes, content) {
        log.warn("Not implemented!");
    }

    notification(content, options) {
        log.warn("Not implemented!");
    }

    // Send methods

    /**
     * @deprecated Use portal().setLocale() instead.
     */
    sendSetLocale(locale, reload) {
        this.portal().setLocale(locale, reload);
    };

    /**
     * @deprecated Use portal().renderPortlet() instead.
     */
    sendRenderPortlet(portletId, modes) {
        this.portal().renderPortlet(portletId, modes);
    };

    /**
     * @deprecated Use portal().addPortlet() instead.
     */
    sendAddPortlet(portletType, renderModes) {
        this.portal().addPortlet(portletType, renderModes);
    };

    /**
     * @deprecated Use portal().removePreview() and portal().removeView() instead.
     */
    sendDeletePortlet(portletId) {
        this.send("deletePortlet", portletId);
    };

    /**
     * @deprecated Use portal().updateLayout() instead.
     */
    sendLayout(previewLayout, tabLayout, xtraInfo) {
        this.portal().updateLayout(previewLayout, tabLayout, xtraInfo);
    };

    /**
     * @deprecated Use portal().send() instead.
     */
    send(method, ...params) {
        this.portal().send(method, ...params);
    };

    // Utility methods.

    /**
     * Find the HTML elements that display the preview or view of the
     * portlet with the given id.
     * 
     * @param {string} portletId the portlet id
     * @return {NodeList} the elements found
     */
    findPortletContainers(portletId) {
        return $(".portlet[data-portlet-id='" + portletId + "']").get();
    };

    /**
     * Find the HTML element that displays the preview of the
     * portlet with the given id.
     * 
     * @param {string} portletId the portlet id
     * @return {HTMLElement} the HTML element
     */
    findPortletPreview(portletId) {
        let matches = $(".portlet-preview[data-portlet-id='" + portletId + "']");
        if (matches.length === 1) {
            return $(matches[0]);
        }
        return null;
    };

    findPreviewIds() {
        let ids = $(".portlet-preview[data-portlet-id]").map(function() {
            return $(this).attr("data-portlet-id");
        }).get();
        return ids;
    }

    /**
     * Find the HTML element that displays the view of the
     * portlet with the given id.
     * 
     * @param {string} portletId the portlet id
     * @return {HTMLElement} the HTML element
     */
    findPortletView(portletId) {
        let matches = $(".portlet-view[data-portlet-id='" + portletId + "']");
        if (matches.length === 1) {
            return $(matches[0]);
        }
        return null;
    };

    findViewIds() {
        let ids = $(".portlet-view[data-portlet-id]").map(function() {
            return $(this).attr("data-portlet-id");
        }).get();
        return ids;
    }

    /**
     * Utility method to format a memory size to a maximum
     * of 4 digits for the integer part by appending the
     * appropriate unit.
     * 
     * @param {integer} size the size value to format
     * @param {integer} digits the number of digits of the factional part
     * @param {string} lang the language (BCP 47 code, 
     * used to determine the delimiter)
     */
    formatMemorySize(size, digits, lang) {
        if (lang === undefined) {
            lang = digits;
            digits = -1;
        }
        let scale = 0;
        while (size > 10000 && scale < 5) {
            size = size / 1024;
            scale += 1;
        }
        let unit = "PiB";
        switch (scale) {
            case 0:
                unit = "B";
                break;
            case 1:
                unit = "kiB";
                break;
            case 2:
                unit = "MiB";
                break;
            case 3:
                unit = "GiB";
                break;
            case 4:
                unit = "TiB";
                break;
            default:
                break;
        }
        if (digits >= 0) {
            return new Intl.NumberFormat(lang, {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            }).format(size) + " " + unit;
        }
        return new Intl.NumberFormat(lang).format(size) + " " + unit;
    }

}

/**
 * Provides portal related methods. A singleton is automatically
 * created. Selected methods are made available in the JGPortal
 * namespace.
 */
class Portal {

    constructor() {
        let self = this;
        this._isConfigured = false;
        this._sessionRefreshInterval = 0;
        this._sessionInactivityTimeout = 0;
        this._renderer = null;
        this._webSocket = new PortalWebSocket(this);
        this._portletFunctionRegistry = {};
        this._previewTemplate = $('<section class="portlet portlet-preview"></section>');
        this._viewTemplate = $('<article class="portlet portlet-view portlet-content"></article>');
        this._editTemplate = $('<div class="portlet portlet-edit"></div>');
        this._webSocket.addMessageHandler('addPageResources',
            function(cssUris, cssSource, scriptResources) {
                self._resourceManager.addPageResources(cssUris, cssSource, scriptResources);
            });
        this._webSocket.addMessageHandler('addPortletType',
            function(portletType, displayNames, cssUris, scriptResources,
                renderModes) {
                self._resourceManager.addPageResources(cssUris, null, scriptResources);
                self._renderer.addPortletType(portletType, displayNames, renderModes);
            });
        this._webSocket.addMessageHandler('lastPortalLayout',
            function(previewLayout, tabsLayout, xtraInfo) {
                // Should we wait with further actions?
                self._resourceManager.lockWhileLoading();
                self._renderer.lastPortalLayout(previewLayout, tabsLayout, xtraInfo);
            });
        this._webSocket.addMessageHandler('notifyPortletView',
            function notifyPortletView(portletClass, portletId, method, params) {
                let classRegistry = self._portletFunctionRegistry[portletClass];
                if (classRegistry) {
                    let f = classRegistry[method];
                    if (f) {
                        f(portletId, params);
                    }
                }
            });
        this._webSocket.addMessageHandler('portalConfigured',
            function portalConfigured() {
                self._isConfigured = true;
                self._renderer.portalConfigured();
            });
        this._webSocket.addMessageHandler('updatePortlet',
            function(portletId, mode, modes, content, foreground) {
                if (mode === "Preview" || mode === "DeleteablePreview") {
                    self._updatePreview(portletId, modes, mode, content, foreground);
                } else if (mode === "View") {
                    self._updateView(portletId, modes, content, foreground);
                } else if (mode === "Edit") {
                    let container = self._editTemplate.clone();
                    container.attr("data-portlet-id", portletId);
                    self._renderer.showEditDialog(container[0], modes, content);
                    if (!container[0].parentNode) {
                        $("body").append(container);
                    }
                    self._execOnLoad(container);
                }
            });
        this._webSocket.addMessageHandler('deletePortlet',
            function deletePortlet(portletId) {
                let portletDisplays = self._renderer.findPortletContainers(portletId);
                if (portletDisplays.length > 0) {
                    self._renderer.removePortletDisplays(portletDisplays);
                }
            });
        this._webSocket.addMessageHandler('displayNotification',
            function(content, options) {
                self._renderer.notification(content, options);
            });
        this._webSocket.addMessageHandler('retrieveLocalData',
            function retrieveLocalData(path) {
                let result = [];
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        let key = localStorage.key(i);
                        if (!path.endsWith("/")) {
                            if (key !== path) {
                                continue;
                            }
                        } else {
                            if (!key.startsWith(path)) {
                                continue;
                            }
                        }
                        let value = localStorage.getItem(key);
                        result.push([key, value])
                    }
                } catch (e) {
                    log.error(e);
                }
                self._webSocket.send({
                    "jsonrpc": "2.0", "method": "retrievedLocalData",
                    "params": [result]
                });
            });
        this._webSocket.addMessageHandler('storeLocalData',
            function storeLocalData(actions) {
                try {
                    for (let i in actions) {
                        let action = actions[i];
                        if (action[0] === "u") {
                            localStorage.setItem(action[1], action[2]);
                        } else if (action[0] === "d") {
                            localStorage.removeItem(action[1]);
                        }
                    }
                } catch (e) {
                    log.error(e);
                }
            });
        this._webSocket.addMessageHandler('reload',
            function() {
                window.location.reload(true);
            });
    }

    init(providedResources, portalSessionId, refreshInterval, 
        inactivityTimeout, renderer) {
        sessionStorage.setItem("org.jgrapes.portal.base.sessionId", portalSessionId);
        this._resourceManager = new ResourceManager(this, providedResources);
        this._sessionRefreshInterval = refreshInterval;
        this._sessionInactivityTimeout = inactivityTimeout;
        this._renderer = renderer;
        JGPortal.renderer = renderer;

        // Everything set up, can connect web socket now.
        this._webSocket.connect();

        // More initialization.
        this._renderer.init();

        // With everything prepared, send portal ready
        this.send("portalReady");
    }

    get isConfigured() {
        return this._isConfigured;
    }

    get sessionRefreshInterval() {
        return this._sessionRefreshInterval;
    }

    get sessionInactivityTimeout() {
        return this._sessionInactivityTimeout;
    }

    get renderer() {
        return this._renderer;
    }

    connectionLost() {
        this._renderer.connectionLost();
    }

    connectionRestored() {
        this._renderer.connectionRestored();
    }

    connectionSuspended(resume) {
        this._renderer.connectionSuspended(resume);
    }

    /**
     * Increases the lock count on the receiver. As long as
     * the lock count is greater than 0, the invocation of
     * handlers is suspended.
     */
    lockMessageQueue() {
        this._webSocket.lockMessageReceiver();
    }

    /**
     * Decreases the lock count on the receiver. When the
     * count reaches 0, the invocation of handlers is resumed.
     */
    unlockMessageQueue() {
        this._webSocket.unlockMessageReceiver();
    }

    // Portlet management

    _updatePreview(portletId, modes, mode, content, foreground) {
        let container = this._renderer.findPortletPreview(portletId);
        let isNew = !container;
        if (isNew) {
            container = this._previewTemplate.clone();
            container.attr("data-portlet-id", portletId);
        }
        if (mode === "DeleteablePreview") {
            container.addClass('portlet-deleteable')
        } else {
            container.removeClass('portlet-deleteable')
        }
        this._renderer.updatePortletPreview(isNew, container[0], modes,
            content, foreground);
        this._execOnLoad(container);
    };

    _updateView(portletId, modes, content, foreground) {
        let container = this._renderer.findPortletView(portletId);
        let isNew = !container;
        if (isNew) {
            container = this._viewTemplate.clone();
            container.attr("data-portlet-id", portletId);
        }
        this._renderer.updatePortletView(isNew, container[0], modes,
            content, foreground);
        this._execOnLoad(container);
    };

    _execOnLoad(container) {
        container.find("[data-jgp-on-load]").each(function() {
            let onLoad = $(this).data("jgp-on-load");
            let segs = onLoad.split(".");
            let obj = window;
            while (obj && segs.length > 0) {
                obj = obj[segs.shift()];
            }
            if (obj && typeof obj === "function") {
                obj($(this)[0]);
            }
        });
    }

    /**
     * Invokes the functions defined in `data-jgp-on-apply`
     * attributes. Must be invoked by edit dialogs when 
     * they are closed.
     * 
     * @param {HTMLElement} container the container of the edit dialog
     */
    execOnApply(container) {
        container = $(container);
        container.find("[data-jgp-on-apply]").each(function() {
            let onApply = $(this).data("jgp-on-apply");
            let segs = onApply.split(".");
            let obj = window;
            while (obj && segs.length > 0) {
                obj = obj[segs.shift()];
            }
            if (obj && typeof obj === "function") {
                obj($(this)[0]);
            }
        });
    }

    /**
     * Registers a portlet method that to be invoked if a
     * JSON RPC notification with method <code>notifyPortletView</code>
     * is received.
     * 
     * @param {string} portletClass the portlet type for which
     * the method is registered
     * @param {string} methodName the method that is registered
     * @param {function} method the function to invoke
     */
    registerPortletMethod(portletClass, methodName, method) {
        let classRegistry = this._portletFunctionRegistry[portletClass];
        if (!classRegistry) {
            classRegistry = {};
            this._portletFunctionRegistry[portletClass] = classRegistry;
        }
        classRegistry[methodName] = method;
    }

    // Send methods

    /**
     * Invokes the given method on the server.
     *
     * @param {string} the method
     * @param {...any} params the parameters
     */
    send(method, ...params) {
        if (params.length > 0) {
            this._webSocket.send({
                "jsonrpc": "2.0", "method": method,
                "params": params
            });
        } else {
            this._webSocket.send({ "jsonrpc": "2.0", "method": method });
        }
    }

    /**
     * Sends a notification for changing the language to the server.
     * 
     * @param {string} locale the id of the selected locale
     */
    setLocale(locale, reload) {
        this.send("setLocale", locale, reload);
    };

    /**
     * Sends a notification that requests the rendering of a portlet.
     * 
     * @param {string} portletId the portlet id
     * @param {string[]} modes the requested render mode(s)
     */
    renderPortlet(portletId, modes) {
        this.send("renderPortlet", portletId, modes);
    };

    /**
     * Sends a notification that requests the addition of a portlet.
     * 
     * @param {string} portletType the type of the portlet to add
     * @param {string[]} renderModes the requested render mode(s)
     */
    addPortlet(portletType, renderModes) {
        this.send("addPortlet", portletType, renderModes);
    };

    /**
     * Requests the removal of a portlet preview. If a view of the
     * portlet exists, it will be removed also.
     *
     * @param {string} the portlet id
     */
    removePreview(portletId) {
        this.send("deletePortlet", portletId);
    }

    /**
     * Requests the removal of a portlet view.
     *
     * @param {string} the portlet id
     */
    removeView(portletId) {
        if (this._renderer.findPortletPreview(portletId)) {
            let view = this._renderer.findPortletView(portletId);
            if (view) {
                this._renderer.removePortletDisplays($(view).get());
            }
        } else {
            this.send("deletePortlet", portletId);
        }
    }

    /**
     * Send a notification that request the removal of a portlet.
     * 
     * @param {string} portletId the id of the portlet to be deleted
     */
    deletePortlet(portletId) {
        this.send("deletePortlet", portletId);
    };

    /**
     * Send the current portal layout to the server.
     *
     * @param {string[]} previewLayout the portlet ids from top left
     * to bottom right
     * @param {string[]} tabsLayout the ids of the portlets viewable in tabs
     * @param {Object} xtraInfo extra information spcific to the 
     * portal implementation
     */
    updateLayout(previewLayout, tabLayout, xtraInfo) {
        if (!thePortal.isConfigured) {
            return;
        }
        this.send("portalLayout", previewLayout, tabLayout, xtraInfo);
    };

    /**
     * Send a notification with method <code>notifyPortletModel</code>
     * and the given portlet id, method and parameters as the 
     * notification's parameters to the server.
     * 
     * @param {string} portletId the id of the portlet to send to
     * @param {string} method the method to invoke
     * @param params the parameters to send
     */
    notifyPortletModel(portletId, method, ...params) {
        if (params === undefined) {
            this.send("notifyPortletModel", portletId, method);
        } else {
            this.send("notifyPortletModel", portletId, method, params);
        }
    };

    // Utility methods

    // https://gist.github.com/jed/982883
    generateUUID() {
        var r = crypto.getRandomValues(new Uint8Array(16));
        r[6] = r[6] & 0x0f | 0x40;
        r[8] = r[8] & 0x3f | 0x80;
        return (r[0].toString(16) + r[1].toString(16) +
            r[2].toString(16) + r[3].toString(16) +
            "-" + r[4].toString(16) + r[5].toString(16) +
            "-" + r[6].toString(16) + r[7].toString(16) +
            "-" + r[8].toString(16) + r[9].toString(16) +
            "-" + r[0].toString(10) + r[0].toString(11) +
            r[0].toString(12) + r[0].toString(13) +
            r[0].toString(14) + r[0].toString(15));
    };

}

var thePortal = new Portal();

/**
 * Initialize the portal singleton.
 * 
 * @memberof JGPortal
 */
JGPortal.init = function(...params) {
    thePortal.init(...params);
}

/**
 * Delegates to {@link Portal#registerPortletMethod}.
 * 
 * @memberof JGPortal
 */
JGPortal.registerPortletMethod = function(...params) {
    thePortal.registerPortletMethod(...params);
}

/**
 * Delegates to {@link Portal#notifyPortletModel}.
 * 
 * @memberof JGPortal
 */
JGPortal.notifyPortletModel = function(...params) {
    return thePortal.notifyPortletModel(...params);
}

/**
 * Delegates to {@link Portal#lockMessageQueue}.
 * 
 * @memberof JGPortal
 */
JGPortal.lockMessageQueue = function(...params) {
    thePortal.lockMessageQueue(...params);
}

/**
 * Delegates to {@link Portal#unlockMessageQueue}.
 * 
 * @memberof JGPortal
 */
JGPortal.unlockMessageQueue = function(...params) {
    thePortal.unlockMessageQueue(...params);
}

/**
 * Delegates to the portal's {@link JGPortal.Renderer#findPortletPreview}.
 * 
 * @memberof JGPortal
 */
JGPortal.findPortletPreview = function(...params) {
    return thePortal.renderer.findPortletPreview(...params);
}

/**
 * Delegates to the portal's {@link JGPortal.Renderer#findPortletView}.
 * 
 * @memberof JGPortal
 */
JGPortal.findPortletView = function(...params) {
    return thePortal.renderer.findPortletView(...params);
}

/**
 * Returns the data (`data-*` Attribute) of the specified
 * element with the given key. If it does not exist, it
 * set to the value provided by the supplier function.
 * 
 * @param {Object} node - the DOM element
 * @param {string} key - the key of the data
 * @param {Object} supplier - the supplier function
 * @returns {Object} the data
 * 
 * @memberof JGPortal
 */
JGPortal.createIfMissing = function(node, key, supplier) {
    let data = node.data(key);
    if (data) {
        return data;
    }
    data = supplier();
    node.data(key, data);
    return data;
}

/**
 * A generic controller for tables. It provides information about
 * the available columns and maintains state regarding their
 * sort order and direction. In addition, it supports simple
 * filtering based on cell content.
 */
JGPortal.TableController = class {

    /**
     * Creates a new controller for a table with the given numer
     * of columns.
     * 
     * @param {string[][]} columns - the columns as a list
     *     of pairs of column key and column label
     * @param {string} options.sortKey - the initial sort key
     * @param {string} options.sortOrder - the initial sort order
     */
    constructor(columns, options) {
        this.keys = [];
        this.labelsByKey = {};
        for (let i in columns) {
            this.keys.push(columns[i][0]);
            this.labelsByKey[columns[i][0]] = columns[i][1];
        }
        this.sortKey = '';
        this.sortOrders = {};
        for (let i in this.keys) {
            this.sortOrders[this.keys[i]] = 1;
        }
        this.filterKey = '';
        if (options) {
            if ("sortKey" in options) {
                this.sortBy(options.sortKey);
            }
            if ("sortOrder" in options) {
                this.sortBy(this.sortKey, options.sortOrder);
            }
        }
    }

    /**
     * Returns the column label for the given column key.
     * 
     * @param {string} key - the column key
     */
    label(key) {
        return this.labelsByKey[key];
    }

    /**
     * Returns the sort order of the column with the given key
     * (1 for "up" and -1 for "down").
     * 
     * @param {string} key - the column key
     */
    sortOrder(key) {
        return this.sortOrders[key];
    }

    /**
     * This method sets the primary sort key. If the order is
     * `undefined`, and the current sort key is the same as the
     * specified key, the current sort order is inverted.
     * 
     * @param {string} key - the column key
     * @param {number} order - the sort order (1 for ascending 
     *     and -1 for descending) or `undefined`
     */
    sortBy(key, order) {
        if (this.sortKey != key) {
            this.sortKey = key;
        }
        else {
            this.sortOrders[key] = this.sortOrders[key] * -1;
        }
        if (typeof order !== 'undefined') {
            if (order === 'up') {
                this.sortOrders[key] = 1;
            }
            if (order === 'down') {
                this.sortOrders[key] = -1;
            }
        }
    }

    /**
     * Returns `true` if given key is the current sort key 
     * and the current sort order for is ascending.
     * 
     * @param {string} key - the column key
     */
    sortedByAsc(key) {
        return this.sortKey == key && this.sortOrders[key] == 1;
    }

    /**
     * Returns `true` if given key is the current sort key 
     * and the current sort order for is descending.
     * 
     * @param {string} key - the column key
     */
    sortedByDesc(key) {
        return this.sortKey == key && this.sortOrders[key] == -1;
    }

    /**
     * Sort and filter the given data according to the current state
     * of the controller. Returns the sorted data.
     */
    filter(data) {
        let filterKey = this.filterKey && this.filterKey.toLowerCase();
        if (filterKey) {
            data = data.filter(function(item) {
                return Object.values(item).some(function(value) {
                    return String(value).toLowerCase().indexOf(filterKey) > -1;
                });
            });
        }
        if (this.sortKey) {
            let sortKey = this.sortKey;
            let order = this.sortOrders[sortKey];
            data = data.sort(function(a, b) {
                a = a[sortKey];
                b = b[sortKey];
                return (a === b ? 0 : a > b ? 1 : -1) * order;
            });
        }
        return data;
    }

    /**
     * Sets a filter for the data.
     * 
     * @param {string} filter - the string to match
     */
    filterBy(filter) {
        this.filterKey = filter;
    }

    /**
     * A convenience method to update the filter from the
     * value of the passed in event.
     * 
     * @param {Object} event - the event which must provide
     *     a value for `$(event.target).val()`. 
     */
    updateFilter(event) {
        this.filterKey = $(event.target).val();
    }

    /**
     * A convenience method for clearing an input element
     * that is used to specify a filter. Searches for 
     * an `input` element in the `event.target`'s enclosing
     * `form` element and sets its value to the empty string.
     * 
     * @param {Object} event - the event 
     */
    clearFilter(event) {
        let form = $(event.target).closest("form");
        let input = form.find("input");
        input.val('');
        this.filterKey = '';
    }

    /**
     * A convenience function that inserts word breaks
     * (`&#x200b`) before every dot in the given text
     * and returns the result.
     * 
     * @param {string} text - the text
     */
    breakBeforeDots(text) {
        return String(text).replace(/\./g, "&#x200b;.");
    }
}

/**
 * Helps to manage options. The main addition to simply using
 * a Set are the toggle functions and the support for temporarily
 * disabling an option.
 */
JGPortal.OptionsSet = class {

    /**
     * Creates a new option set.
     */
    constructor() {
        this.enabled = new Map();
        this.disabled = new Map();
    }

    /**
     * Sets the option with the associated value.
     * 
     * @param {string} name - the option's name
     * @param {string} value - the option's value
     */
    set(name, value) {
        this.enabled.set(name, value);
        this.disabled.delete(name);
    }

    /**
     * Returns the value of the given name.
     * 
     * @param {string} name - the option's name
     */
    get(name) {
        return this.enabled.get(name);
    }

    /**
     * Returns the names of all enabled options.
     */
    getEnabled() {
        return this.enabled.keys();
    }

    /**
     * Returns the names of all disabled options.
     */
    getDisabled() {
        return this.disabled.keys();
    }

    /**
     * Returns the names of all options.
     */
    getAll() {
        return (new Set([...this.enabled.keys(), ...this.disabled.keys()]))
            .values();
    }

    /**
     * Clears the option set.
     */
    clear() {
        this.enabled.clear();
        this.disabled.clear();
    }

    /**
     * Deletes the option with the given name.
     * 
     * @param {string} name - the option's name
     */
    delete(name) {
        this.enabled.delete(name);
        this.disabled.delete(name);
    }

    /**
     * Disables the option with the given name. The option
     * and its value are kept and can be re-enabled.
     * 
     * @param {string} name - the option's name
     */
    disable(name) {
        if (this.enabled.has(name)) {
            this.disabled.set(name, this.enabled.get(name));
            this.enabled.delete(name);
        }
    }

    /**
     * Re-enables the option with the given name.
     * 
     * @param {string} name - the option's name
     */
    enable(name) {
        if (this.disabled.has(name)) {
            this.enabled.set(name, this.disabled.get(name));
            this.disabled.delete(name);
        }
    }

    /**
     * Toggles the option with the given name, i.e. enables
     * it if it is disabled and disables it if it is enabled.
     * 
     * @param {string} name - the option's name
     */
    toggleEnabled(name) {
        if (this.enabled.has(name)) {
            this.disable(name);
        } else {
            this.enable(name);
        }
    }

    /**
     * Sets the option with the given name if it is not
     * set and deletes it if it is enabled.
     * 
     * @param {string} name - the option's name
     * @param {string} value - the option's value
     */
    toggleIsSet(name, value) {
        if (this.enabled.has(name)) {
            this.enabled.delete(name);
        } else {
            this.enabled.set(name, value);
        }
    }
}