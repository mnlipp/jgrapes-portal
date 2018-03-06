/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2017-2018 Michael N. Lipp
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License 
 * for more details.
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

package org.jgrapes.portal.events;

import java.util.List;
import java.util.Optional;

import org.jdrupes.json.JsonArray;
import org.jdrupes.json.JsonObject;
import org.jdrupes.json.JsonRpc;
import org.jgrapes.core.Channel;
import org.jgrapes.core.Components;
import org.jgrapes.core.Event;

/**
 * A JSON notification from the portal view (browser) to the portal. 
 */
public class JsonInput extends Event<Void> implements JsonRpc {

	private String method;
	private JsonArray params;
	private Optional<Object> id;
	
	/**
	 * Create a new request from the given data.
	 * 
	 * @param requestData a request as defined by the JSON RPC specification 
	 */
	@SuppressWarnings("unchecked")
	public JsonInput(JsonObject requestData) {
		method = (String)requestData.get("method");
		params = JsonArray.fromData((List<Object>)requestData.get("params"));
		id = Optional.ofNullable(requestData.get("id"));
	}

	/**
	 * The invoked method.
	 * 
	 * @return the method
	 */
	public String method() {
		return method;
	}

	/**
	 * The parameters.
	 * 
	 * @return the params
	 */
	public JsonArray params() {
		return params;
	}

	/**
	 * An optional request id.
	 * 
	 * @return the id
	 */
	public Optional<Object> id() {
		return id;
	}

	/* (non-Javadoc)
	 * @see java.lang.Object#toString()
	 */
	@Override
	public String toString() {
		StringBuilder builder = new StringBuilder();
		builder.append(Components.objectName(this));
		builder.append(" [");
		if (method != null) {
			builder.append("method=");
			builder.append(method);
			builder.append(", ");
		}
		if (id.isPresent()) {
			builder.append("id=");
			builder.append(id.get());
		}
		if (channels() != null) {
			builder.append("channels=");
			builder.append(Channel.toString(channels()));
		}
		builder.append("]");
		return builder.toString();
	}
}
