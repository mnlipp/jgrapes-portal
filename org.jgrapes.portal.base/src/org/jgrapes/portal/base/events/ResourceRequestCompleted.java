/*
 * Ad Hoc Polling Application
 * Copyright (C) 2018 Michael N. Lipp
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

package org.jgrapes.portal.base.events;

import org.jgrapes.core.Channel;
import org.jgrapes.core.CompletionEvent;

/**
 * Indicates that a {@link ResourceRequest} event has been completed.
 */
public class ResourceRequestCompleted
        extends CompletionEvent<ResourceRequest> {

    /**
     * Instantiates a new event.
     *
     * @param monitoredEvent the monitored event
     * @param channels the channels
     */
    public ResourceRequestCompleted(ResourceRequest monitoredEvent,
            Channel... channels) {
        super(monitoredEvent, channels);
    }

}
