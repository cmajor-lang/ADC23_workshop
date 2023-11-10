


/// This event listener management class allows listeners to be attached and
/// removed from named event types.
export class EventListenerList
{
    constructor()
    {
        this.listenersPerType = {};
    }

    /// Adds a listener for a specifc event type.
    /// If the listener is already registered, this will simply add it again.
    /// Each call to addEventListener() must be paired with a removeventListener()
    /// call to remove it.
    addEventListener (type, listener)
    {
        if (type && listener)
        {
            const list = this.listenersPerType[type];

            if (list)
                list.push (listener);
            else
                this.listenersPerType[type] = [listener];
        }
    }

    /// Removes a listener that was previously added to the given event.
    removeEventListener (type, listener)
    {
        if (type && listener)
        {
            const list = this.listenersPerType[type];

            if (list)
            {
                const i = list.indexOf (listener);

                if (i >= 0)
                    list.splice (i, 1);
            }
        }
    }

    /// Attaches a callback function that will be automatically unregistered
    /// the first time it is invoked.
    addSingleUseListener (type, listener)
    {
        const l = message =>
        {
            this.removeEventListener (type, l);
            listener?.(message);
        };

        this.addEventListener (type, l);
    }

    /// Synchronously dispatches an event object to all listeners
    /// that are registered for the given type.
    dispatchEvent (type, event)
    {
        const list = this.listenersPerType[type];

        if (list)
            for (const listener of list)
                listener?.(event);
    }

    /// Returns the number of listeners that are currently registered
    /// for the given type of event.
    getNumListenersForType (type)
    {
        const list = this.listenersPerType[type];
        return list ? list.length : 0;
    }
}

//==============================================================================
/// This class implements the API and much of the logic for communicating with
/// an instance of a patch that is running.
export class PatchConnection  extends EventListenerList
{
    constructor()
    {
        super();
    }

    //==============================================================================
    // Status-handling methods:

    /// Calling this will trigger an asynchronous callback to any status listeners with the
    /// patch's current state. Use addStatusListener() to attach a listener to receive it.
    requestStatusUpdate()                             { this.sendMessageToServer ({ type: "req_status" }); }

    /// Attaches a listener function that will be called whenever the patch's status changes.
    /// The function will be called with a parameter object containing many properties describing the status,
    /// including whether the patch is loaded, any errors, endpoint descriptions, its manifest, etc.
    addStatusListener (listener)                      { this.addEventListener    ("status", listener); }
    /// Removes a listener that was previously added with addStatusListener()
    removeStatusListener (listener)                   { this.removeEventListener ("status", listener); }

    /// Causes the patch to be reset to its "just loaded" state.
    resetToInitialState()                             { this.sendMessageToServer ({ type: "req_reset" }); }

    //==============================================================================
    // Methods for sending data to input endpoints:

    /// Sends a value to one of the patch's input endpoints.
    /// This can be used to send a value to either an 'event' or 'value' type input endpoint.
    /// If the endpoint is a 'value' type, then the rampFrames parameter can optionally be used to specify
    /// the number of frames over which the current value should ramp to the new target one.
    /// The value parameter will be coerced to the type that is expected by the endpoint. So for
    /// examples, numbers will be converted to float or integer types, javascript objects and arrays
    /// will be converted into more complex types in as good a fashion is possible.
    sendEventOrValue (endpointID, value, rampFrames)  { this.sendMessageToServer ({ type: "send_value", id: endpointID, value: value, rampFrames: rampFrames }); }

    /// Sends a short MIDI message value to a MIDI endpoint.
    /// The value must be a number encoded with `(byte0 << 16) | (byte1 << 8) | byte2`.
    sendMIDIInputEvent (endpointID, shortMIDICode)    { this.sendEventOrValue (endpointID, { message: shortMIDICode }); }

    /// Tells the patch that a series of changes that constitute a gesture is about to take place
    /// for the given endpoint. Remember to call sendParameterGestureEnd() after they're done!
    sendParameterGestureStart (endpointID)            { this.sendMessageToServer ({ type: "send_gesture_start", id: endpointID }); }

    /// Tells the patch that a gesture started by sendParameterGestureStart() has finished.
    sendParameterGestureEnd (endpointID)              { this.sendMessageToServer ({ type: "send_gesture_end", id: endpointID }); }

    //==============================================================================
    // Stored state control methods:

    /// Requests a callback to any stored-state value listeners with the current value of a given key-value pair.
    /// To attach a listener to receive these events, use addStoredStateValueListener().
    requestStoredStateValue (key)                     { this.sendMessageToServer ({ type: "req_state_value", key: key }); }
    /// Modifies a key-value pair in the patch's stored state.
    sendStoredStateValue (key, newValue)              { this.sendMessageToServer ({ type: "send_state_value", key : key, value: newValue }); }

    /// Attaches a listener function that will be called when any key-value pair in the stored state is changed.
    /// The listener function will receive a message parameter with properties 'key' and 'value'.
    addStoredStateValueListener (listener)            { this.addEventListener    ("state_key_value", listener); }
    /// Removes a listener that was previously added with addStoredStateValueListener().
    removeStoredStateValueListener (listener)         { this.removeEventListener ("state_key_value", listener); }

    /// Applies a complete stored state to the patch.
    /// To get the current complete state, use requestFullStoredState().
    sendFullStoredState (fullState)                   { this.sendMessageToServer ({ type: "send_full_state", value: fullState }); }

    /// Asynchronously requests the full stored state of the patch.
    /// The listener function that is supplied will be called asynchronously with the state as its argument.
    requestFullStoredState (callback)
    {
        const replyType = "fullstate_response_" + (Math.floor (Math.random() * 100000000)).toString();
        this.addSingleUseListener (replyType, callback);
        this.sendMessageToServer ({ type: "req_full_state", replyType: replyType });
    }

    //==============================================================================
    // Listener methods:

    /// Attaches a listener function that will receive updates with the events or audio data
    /// that is being sent or received by an endpoint.
    /// If the endpoint is an event or value, the callback will be given an argument which is
    /// the new value.
    /// If the endpoint has the right shape to be treated as "audio" then the callback will receive
    /// a stream of updates of the min/max range of chunks of data that is flowing through it.
    /// There will be one callback per chunk of data, and the size of chunks is specified by
    /// the optional granularity parameter.
    /// If sendFullAudioData is false, the listener will receive an argument object containing
    /// two properties 'min' and 'max', which are each an array of values, one element per audio
    /// channel. This allows you to find the highest and lowest samples in that chunk for each channel.
    /// If sendFullAudioData is true, the listener's argument will have a property 'data' which is an
    /// array containing one array per channel of raw audio samples data.
    addEndpointListener (endpointID, listener, granularity, sendFullAudioData)
    {
        listener.eventID = "event_" + endpointID + "_" + (Math.floor (Math.random() * 100000000)).toString();
        this.addEventListener (listener.eventID, listener);
        this.sendMessageToServer ({ type: "add_endpoint_listener", endpoint: endpointID, replyType:
                                    listener.eventID, granularity: granularity, fullAudioData: sendFullAudioData });
    }

    /// Removes a listener that was previously added with addEndpointListener()
    removeEndpointListener (endpointID, listener)
    {
        this.removeEventListener (listener.eventID, listener);
        this.sendMessageToServer ({ type: "remove_endpoint_listener", endpoint: endpointID, replyType: listener.eventID });
    }

    /// This will trigger an asynchronous callback to any parameter listeners that are
    /// attached, providing them with its up-to-date current value for the given endpoint.
    /// Use addAllParameterListener() to attach a listener to receive the result.
    requestParameterValue (endpointID)                  { this.sendMessageToServer ({ type: "req_param_value", id: endpointID }); }

    /// Attaches a listener function which will be called whenever the value of a specific parameter changes.
    /// The listener function will be called with an argument which is the new value.
    addParameterListener (endpointID, listener)         { this.addEventListener ("param_value_" + endpointID.toString(), listener); }
    /// Removes a listener that was previously added with addParameterListener()
    removeParameterListener (endpointID, listener)      { this.removeEventListener ("param_value_" + endpointID.toString(), listener); }

    /// Attaches a listener function which will be called whenever the value of any parameter changes in the patch.
    /// The listener function will be called with an argument object with the fields 'endpointID' and 'value'.
    addAllParameterListener (listener)                  { this.addEventListener ("param_value", listener); }
    /// Removes a listener that was previously added with addAllParameterListener()
    removeAllParameterListener (listener)               { this.removeEventListener ("param_value", listener); }

    /// This takes a relative path to an asset within the patch bundle, and converts it to a
    /// path relative to the root of the browser that is showing the view.
    /// You need you use this in your view code to translate your asset URLs to a form that
    /// can be safely used in your view's HTML DOM (e.g. in its CSS). This is needed because the
    /// host's HTTP server (which is delivering your view pages) may have a different '/' root
    /// than the root of your patch (e.g. if a single server is serving multiple patch GUIs).
    getResourceAddress (path)                           { return path; }


    //==============================================================================
    // Private methods follow this point..

    /// For internal use - delivers an incoming message object from the underlying API.
    deliverMessageFromServer (msg)
    {
        if (msg.type === "status")
            this.manifest = msg.message?.manifest;

        if (msg.type == "param_value")
            this.dispatchEvent ("param_value_" + msg.message.endpointID, msg.message.value);

        this.dispatchEvent (msg.type, msg.message);
    }
}

export async function createAudioWorkletNodePatchConnection ({
    audioContext,
    workletName,
    sessionID,
    initialValueOverrides,
})
{
    return makeWorkletNodePatchConnectionFromWrapper ({
        Wrapper: CmajorWrapper,
        manifest: getManifest(),
        audioContext,
        workletName,
        sessionID,
        initialValueOverrides,
    });
}

// adapt the wrapper class generated from `cmaj generate --target=wasm` into an AudioWorkletNode
export async function makeWorkletNodePatchConnectionFromWrapper ({
    Wrapper,
    manifest,
    audioContext,
    workletName,
    sessionID,
    initialValueOverrides,
})
{
    const workletBlob = serialiseWorkletProcessorFactoryToBlob (workletName, Wrapper);
    await audioContext.audioWorklet.addModule (URL.createObjectURL (workletBlob));

    const node = new AudioWorkletNode (audioContext, workletName, {
        ...toChannelProperties (
            Wrapper.prototype.getInputEndpoints(),
            Wrapper.prototype.getOutputEndpoints()
        ),
        processorOptions: {
            sessionID,
            initialValueOverrides,
        },
    });

    const waitUntilWorkletInitialised = async () =>
    {
        return new Promise ((resolve) =>
        {
            const filterForInitialised = (e) =>
            {
                if (e.data.type === "initialised")
                {
                    node.port.removeEventListener ("message", filterForInitialised);
                    resolve();
                }
            };
            node.port.addEventListener ("message", filterForInitialised);
        });
    };

    node.port.start();

    await waitUntilWorkletInitialised();

    class AudioWorkletPatchConnection extends PatchConnection
    {
        constructor ({ postClientRequest, subscribe })
        {
            super();

            subscribe (msg =>
            {
                if (msg?.type === "status")
                    msg.message = { manifest, ...msg.message };

                this.deliverMessageFromServer (msg)
            });

            this.postClientRequest = (msg) => postClientRequest (msg);
            this.cachedState = {};
        }

        requestStoredStateValue (key)
        {
            const maybeValue = this.cachedState[key];
            if (maybeValue != null)
                this.dispatchEvent ("state_key_value", { key, value: maybeValue });
        }

        sendStoredStateValue (key, newValue)
        {
            const changed = this.cachedState[key] != newValue;

            if (changed)
            {
                const shouldRemove = newValue == null;
                if (shouldRemove)
                {
                    delete this.cachedState[key];
                    return;
                }

                this.cachedState[key] = newValue;
                // N.B. notifying the client only when updating matches behaviour of the patch player
                this.dispatchEvent ("state_key_value", { key, value: newValue });
            }
        }

        sendFullStoredState (fullState)
        {
            const currentStateCleared = (() =>
            {
                const out = {};
                Object.keys (this.cachedState).forEach (k => out[k] = undefined);
                return out;
            })();
            const incomingStateValues = fullState.values ?? {};
            const nextStateValues = { ...currentStateCleared, ...incomingStateValues };

            Object.entries (nextStateValues).forEach (([key, value]) => this.sendStoredStateValue (key, value));

            // N.B. worklet will handle the `parameters` part
            super.sendFullStoredState (fullState);
        }

        requestFullStoredState (callback)
        {
            // N.B. the worklet only handles the `parameters` part, so we patch the key-value state in here
            super.requestFullStoredState (msg => callback ({ values: { ...this.cachedState }, ...msg }));
        }

        sendMessageToServer (msg)
        {
            this.postClientRequest (msg);
        }
    };

    const connection = new AudioWorkletPatchConnection ({
        postClientRequest: (msg) => node.port.postMessage ({ type: "patch", payload: msg }),
        subscribe: (fn) =>
        {
            node.port.addEventListener ("message", e =>
            {
                if (e.data.type !== "patch") return;

                fn (e.data.payload);
            });
        },
    });

    return {
        node,
        connection,
    };
}

function toChannelProperties (inputEndpoints, outputEndpoints)
{
    const audioInputEndpoints = inputEndpoints.filter (({ purpose }) => purpose === "audio in");
    const audioOutputEndpoints = outputEndpoints.filter (({ purpose }) => purpose === "audio out");

    // N.B. we just take the first for now (and do the same in the processor too).
    // we can do better, and should probably align with something similar to what the patch player does
    const pickFirstEndpointChannelCount = (endpoints) => endpoints.length ? endpoints[0].numAudioChannels : 0;

    const inputChannelCount = pickFirstEndpointChannelCount (audioInputEndpoints);
    const outputChannelCount = pickFirstEndpointChannelCount (audioOutputEndpoints);

    const hasInput = inputChannelCount > 0;
    const hasOutput = outputChannelCount > 0;

    return {
        numberOfInputs: +hasInput,
        numberOfOutputs: +hasOutput,
        channelCountMode: "explicit",
        channelCount: hasInput ? inputChannelCount : undefined,
        outputChannelCount: hasOutput ? [outputChannelCount] : [],
    };
}

// N.B. code will be serialised to a string, so all `registerWorkletProcessor`s dependencies must be self contained.
// i.e. `Wrapper` and `registerWorkletProcessor` cannot close over variables / functions from the outer scope
function serialiseWorkletProcessorFactoryToBlob (name, Wrapper)
{
    const serialisedInvocation = `(${registerWorkletProcessor.toString()}) ("${name}", ${Wrapper.toString()});`
    return new Blob ([serialisedInvocation], { type: "text/javascript" });
}

function registerWorkletProcessor (name, Wrapper)
{
    function makeConsumeOutputEvents ({ wrapper, eventOutputs, dispatchOutputEvent })
    {
        const outputEventHandlers = eventOutputs.map (({ endpointID }) =>
        {
            const readCount = wrapper[`getOutputEventCount_${endpointID}`]?.bind (wrapper);
            const reset = wrapper[`resetOutputEventCount_${endpointID}`]?.bind (wrapper);
            const readEventAtIndex = wrapper[`getOutputEvent_${endpointID}`]?.bind (wrapper);

            return () =>
            {
                const count = readCount();
                for (let i = 0; i < count; ++i)
                    dispatchOutputEvent (endpointID, readEventAtIndex (i));

                reset();
            };
        });

        return () => outputEventHandlers.forEach ((consume) => consume() );
    }

    function setInitialParameterValues (parametersMap)
    {
        for (const { initialise } of Object.values (parametersMap))
            initialise();
    }

    function makeEndpointMap (wrapper, endpoints, initialValueOverrides)
    {
        const toKey = ({ endpointType, endpointID }) =>
        {
            switch (endpointType)
            {
                case "event": return `sendInputEvent_${endpointID}`;
                case "value": return `setInputValue_${endpointID}`;
            }

            throw "Unhandled endpoint type";
        };

        const lookup = {};
        for (const { endpointID, endpointType, annotation, purpose } of endpoints)
        {
            const key = toKey ({ endpointType, endpointID });
            const wrapperUpdate = wrapper[key]?.bind (wrapper);

            const snapAndConstrainValue = (value) =>
            {
                if (annotation.step != null)
                    value = Math.round (value / annotation.step) * annotation.step;

                if (annotation.min != null && annotation.max != null)
                    value = Math.min (Math.max (value, annotation.min), annotation.max);

                return value;
            };

            const update = (value, rampFrames) =>
            {
                // N.B. value clamping and rampFrames from annotations not currently applied
                const entry = lookup[endpointID];
                entry.cachedValue = value;
                wrapperUpdate (value, rampFrames);
            };

            if (update)
            {
                const initialValue = initialValueOverrides[endpointID] ?? annotation?.init;
                lookup[endpointID] = {
                    snapAndConstrainValue,
                    update,
                    initialise: initialValue != null ? () => update (initialValue) : () => {},
                    purpose,
                    cachedValue: undefined,
                };
            }
        }

        return lookup;
    }

    function makeStreamEndpointHandler ({ wrapper, toEndpoints, wrapperMethodNamePrefix })
    {
        const endpoints = toEndpoints (wrapper);
        if (endpoints.length === 0)
            return () => {};

        // N.B. we just take the first for now (and do the same when creating the node).
        // we can do better, and should probably align with something similar to what the patch player does
        const first = endpoints[0];
        const handleFrames = wrapper[`${wrapperMethodNamePrefix}_${first.endpointID}`]?.bind (wrapper);
        if (! handleFrames)
            return () => {};

        return (channels, blockSize) => handleFrames (channels, blockSize);
    }

    function makeInputStreamEndpointHandler (wrapper)
    {
        return makeStreamEndpointHandler ({
            wrapper,
            toEndpoints: wrapper => wrapper.getInputEndpoints().filter (({ purpose }) => purpose === "audio in"),
            wrapperMethodNamePrefix: "setInputStreamFrames",
        });
    }

    function makeOutputStreamEndpointHandler (wrapper)
    {
        return makeStreamEndpointHandler ({
            wrapper,
            toEndpoints: wrapper => wrapper.getOutputEndpoints().filter (({ purpose }) => purpose === "audio out"),
            wrapperMethodNamePrefix: "getOutputFrames",
        });
    }

    registerProcessor (name, class extends AudioWorkletProcessor {
        static get parameterDescriptors()
        {
            return [];
        }

        constructor ({ processorOptions, ...options })
        {
            super (options);

            this.processImpl = undefined;
            this.consumeOutputEvents = undefined;

            const { sessionID = Date.now(), initialValueOverrides = {} } = processorOptions;
            const wasmBytes = Wrapper.prototype.getWasmBytes();

            this.compileThenInitialise (Wrapper, wasmBytes, sessionID, initialValueOverrides);
        }

        process (inputs, outputs)
        {
            const input = inputs[0];
            const output = outputs[0];

            this.processImpl?.(input, output);
            this.consumeOutputEvents?.();

            return true;
        }

        async compileThenInitialise (Wrapper, wasmBytes, sessionID, initialValueOverrides)
        {
            try
            {
                const { instance } = await WebAssembly.instantiate (wasmBytes, {});
                const wrapper = new Wrapper (instance, instance.exports.memory.buffer);

                const { initialise, advance } = instance.exports;

                initialise (sessionID, sampleRate);

                const inputParameters = wrapper.getInputEndpoints().filter (({ purpose }) => purpose === "parameter");
                const parametersMap = makeEndpointMap (wrapper, inputParameters, initialValueOverrides);
                setInitialParameterValues (parametersMap);

                const toParameterValuesWithKey = (endpointKey, parametersMap) =>
                {
                    const toValue = ([endpoint, { cachedValue }]) => ({ [endpointKey]: endpoint, value: cachedValue });
                    return Object.entries (parametersMap).map (toValue);
                };

                const initialValues = toParameterValuesWithKey ("endpointID", parametersMap);
                const wasmHeapBytes = new Uint8Array (instance.exports.memory.buffer);
                const wasmHeapInitialStateBytes = wasmHeapBytes.slice (0);

                const resetState = () =>
                {
                    wasmHeapBytes.set (wasmHeapInitialStateBytes);
                    // N.B. update cache used for `req_param_value` messages (we don't currently read from the wasm heap)
                    setInitialParameterValues (parametersMap);
                };

                const isNonAudioOrParameterEndpoint = ({ purpose }) => ! ["audio in", "parameter"].includes (purpose);
                const otherInputs = wrapper.getInputEndpoints().filter (isNonAudioOrParameterEndpoint);
                const otherInputEndpointsMap = makeEndpointMap (wrapper, otherInputs, initialValueOverrides);

                const isEvent = ({ endpointType }) => endpointType === "event";
                const eventInputs = wrapper.getInputEndpoints().filter (isEvent);
                const eventOutputs = wrapper.getOutputEndpoints().filter (isEvent);

                const makeEndpointListenerMap = (eventEndpoints) =>
                {
                    const listeners = {};

                    for (const { endpointID } of eventEndpoints)
                        listeners[endpointID] = [];

                    return listeners;
                };

                const inputEventListeners = makeEndpointListenerMap (eventInputs);
                const outputEventListeners = makeEndpointListenerMap (eventOutputs);

                this.consumeOutputEvents = makeConsumeOutputEvents ({
                    eventOutputs,
                    wrapper,
                    dispatchOutputEvent: (endpointID, event) =>
                    {
                        for (const { replyType } of outputEventListeners[endpointID] ?? [])
                        {
                            this.port.postMessage ({
                                type: "patch",
                                payload: {
                                    type: replyType,
                                    message: event.event, // N.B. chucking away frame and typeIndex info for now
                                },
                            });
                        }
                    },
                });

                const blockSize = 128;
                const prepareInputFrames = makeInputStreamEndpointHandler (wrapper);
                const processOutputFrames = makeOutputStreamEndpointHandler (wrapper);

                this.processImpl = (input, output) =>
                {
                    prepareInputFrames (input, blockSize);
                    advance (blockSize);
                    processOutputFrames (output, blockSize);
                };

                // N.B. the message port makes things straightforward, but it allocates (when sending + receiving).
                // so, we aren't doing ourselves any favours. we probably ought to marshal raw bytes over to the gui in
                // a pre-allocated lock-free message queue (using `SharedArrayBuffer` + `Atomic`s) and transform the raw
                // messages there.
                this.port.addEventListener ("message", e =>
                {
                    if (e.data.type !== "patch") return;

                    const { type, ...msg } = e.data.payload;

                    const makeParameterValueMessage = ({ endpointID, value }) => ({
                        type: "patch",
                        payload: {
                            type: "param_value",
                            message: { endpointID, value }
                        },
                    });
                    const notifyParameterValueChanged = (v) => this.port.postMessage (makeParameterValueMessage (v));

                    switch (type)
                    {
                        case "req_status" :
                        {
                            this.port.postMessage ({
                                type: "patch",
                                payload: {
                                    type: "status",
                                    message: {
                                        details: {
                                            inputs: wrapper.getInputEndpoints(),
                                            outputs: wrapper.getOutputEndpoints(),
                                        },
                                        sampleRate,
                                    },
                                },
                            });
                            break;
                        }
                        case "req_reset":
                        {
                            resetState();
                            initialValues.forEach (v => notifyParameterValueChanged (v));
                            break;
                        }
                        case "req_param_value":
                        {
                            // N.B. keep a local cache here so that we can send the values back when requested.
                            // we could instead have accessors into the wasm heap.
                            const endpointID = msg.id;
                            const parameter = parametersMap[endpointID];
                            if (! parameter) return;

                            const value = parameter.cachedValue;
                            notifyParameterValueChanged ({ endpointID, value });

                            break;
                        }
                        case "send_value":
                        {
                            const endpointID = msg.id;

                            const parameter = parametersMap[endpointID];

                            if (parameter)
                            {
                                const newValue = parameter.snapAndConstrainValue (msg.value);
                                parameter.update (newValue, msg.rampFrames);

                                notifyParameterValueChanged ({ endpointID, value: newValue });
                                return;
                            }

                            const inputEndpoint = otherInputEndpointsMap[endpointID];
                            if (inputEndpoint)
                            {
                                inputEndpoint.update (msg.value);

                                for (const { replyType } of inputEventListeners[endpointID] ?? [])
                                {
                                    this.port.postMessage ({
                                        type: "patch",
                                        payload: {
                                            type: replyType,
                                            message: inputEndpoint.cachedValue,
                                        },
                                    });
                                }
                            }

                            break;
                        }
                        case "send_gesture_start": break;
                        case "send_gesture_end": break;
                        case "req_full_state":
                            this.port.postMessage ({
                                type: "patch",
                                payload: {
                                    type: msg?.replyType,
                                    message: {
                                        parameters: toParameterValuesWithKey ("name", parametersMap),
                                    },
                                },
                            });
                            break;
                        case "send_full_state":
                        {
                            const { parameters = [] } = e.data.payload?.value || [];

                            for (const [endpointID, parameter] of Object.entries (parametersMap))
                            {
                                const namedNextValue = parameters.find (({ name }) => name === endpointID);

                                if (namedNextValue)
                                    parameter.update (namedNextValue.value);
                                else
                                    parameter.initialise();

                                notifyParameterValueChanged ({ endpointID, value: parameter.cachedValue });
                            }
                            break;
                        }
                        case "add_endpoint_listener":
                        {
                            const insertIfValidEndpoint = (lookup, msg) =>
                            {
                                const endpointID = msg?.endpoint;

                                const listeners = lookup[endpointID]

                                if (! listeners)
                                    return false;

                                return listeners.push ({ replyType: msg?.replyType }) > 0;
                            };

                            if (! insertIfValidEndpoint (inputEventListeners, msg))
                                insertIfValidEndpoint (outputEventListeners, msg)

                            break;
                        }
                        case "remove_endpoint_listener":
                        {
                            const removeIfValidReplyType = (lookup, msg) =>
                            {
                                const endpointID = msg?.endpoint;

                                const listeners = lookup[endpointID];

                                if (! listeners)
                                    return false;

                                const index = listeners.indexOf (msg?.replyType);

                                if (index === -1)
                                    return false;

                                return listeners.splice (index, 1).length === 1;
                            };

                            if (! removeIfValidReplyType (inputEventListeners, msg))
                                removeIfValidReplyType (outputEventListeners, msg)

                            break;
                        }
                        default: break;
                    }
                });

                this.port.postMessage ({ type: "initialised" });
                this.port.start();
            }
            catch (e)
            {
                this.port.postMessage (e.toString());
            }
        }
    });
}

class CmajorWrapper
{
  constructor (wasmInstance, wasmMemoryArrayBuffer)
  {
    this.instance = wasmInstance;
    this.memoryArrayBuffer  = wasmMemoryArrayBuffer;

    this.memoryInt32      = new Int32Array    (wasmMemoryArrayBuffer);
    this.memoryFloat32    = new Float32Array  (wasmMemoryArrayBuffer);
    this.memoryInt64_0    = new BigInt64Array (wasmMemoryArrayBuffer);
    // TODO Find a way of writing to BigInt64Array and Float64Array at 4 byte offset
    this.memoryFloat64_0  = new Float64Array  (wasmMemoryArrayBuffer);

    // Placeholder to save allocating memory on audio thread
    this.streamWrapperArray = [ null ];

    this.inputStreamValues = [NaN, ];
  }

  //==============================================================================
  getOutputEndpoints()
  {
    return [
      {
        "endpointID": "out",
        "endpointType": "stream",
        "dataType": {
          "type": "float32"
        },
        "purpose": "audio out",
        "numAudioChannels": 1
      }
    ];
  }

  getInputEndpoints()
  {
    return [
      {
        "endpointID": "shape",
        "endpointType": "value",
        "dataType": {
          "type": "float32"
        },
        "annotation": {
          "name": "Shape",
          "min": 0,
          "max": 100,
          "init": 0
        },
        "purpose": "parameter"
      },
      {
        "endpointID": "rate",
        "endpointType": "event",
        "dataType": {
          "type": "float32"
        },
        "annotation": {
          "name": "Rate",
          "min": 0.1,
          "max": 20,
          "init": 8,
          "unit": "Hz"
        },
        "purpose": "parameter"
      },
      {
        "endpointID": "depth",
        "endpointType": "event",
        "dataType": {
          "type": "float32"
        },
        "annotation": {
          "name": "Depth",
          "min": 0,
          "max": 100,
          "init": 100,
          "unit": "%"
        },
        "purpose": "parameter"
      },
      {
        "endpointID": "bypass",
        "endpointType": "value",
        "dataType": {
          "type": "bool"
        },
        "annotation": {
          "name": "Bypass",
          "boolean": true
        },
        "purpose": "parameter"
      },
      {
        "endpointID": "in",
        "endpointType": "stream",
        "dataType": {
          "type": "float32"
        },
        "purpose": "audio in",
        "numAudioChannels": 1
      }
    ];
  }

  setInputValue_shape (value, frames)
  {
    this._pack_f32 (0, value);
    this.instance.exports._setValue_shape (832, 0, frames);
  }

  sendInputEvent_rate (eventValue)
  {
    this.instance.exports._sendEvent_rate (832, eventValue);
  }

  sendInputEvent_depth (eventValue)
  {
    this.instance.exports._sendEvent_depth (832, eventValue);
  }

  setInputValue_bypass (value, frames)
  {
    this._pack_b (0, value);
    this.instance.exports._setValue_bypass (832, 0, frames);
  }

  setInputStreamFrames_in (sourceChannelArrays, numFramesToWrite, startChannel = 0)
  {
    try {
      var channels;

      if (isNaN(sourceChannelArrays[startChannel][0]))
      {
        // If a single channel is passed in, wrap it into an array
        this.streamWrapperArray[0] = sourceChannelArrays;
        channels = this.streamWrapperArray;
      }
      else
      {
        if (startChannel != 0)
          channels = sourceChannelArrays.slice (startChannel);
        else
          channels = sourceChannelArrays;
      }

      // If a single incoming value is the same as the previously written value, do nothing
      if (channels[0].length == 1 && channels[0][0] == this.inputStreamValues[0])
          return;

      if (numFramesToWrite > 512)
        numFramesToWrite = 512;

      var channelsToCopy = channels.length;
      var channelsToClear = 0;

      if (channelsToCopy > 1)
      {
        channelsToClear = channelsToCopy - 1;
        channelsToCopy = 1;
      }

      var frameDataByteOffset = 1044;

      for (var frame = 0; frame < numFramesToWrite; ++frame)
      {
        for (var channel = 0; channel < channelsToCopy; ++channel)
        {
          var sample = channels[channel][frame];

          if (sample !== undefined)
            this._pack_f32 (frameDataByteOffset, sample);
          else
            this._pack_f32 (frameDataByteOffset, 0);

          frameDataByteOffset += 4;
        }

        for (var channel = 0; channel < channelsToClear; ++channel)
        {
          this._pack_f32 (frameDataByteOffset, 0);
          frameDataByteOffset += 4;
        }
      }

      if (channels[0].length == 1 && channels[0][0].length == 1)
        this.inputStreamValues[0] = channels[0][0];

    }
    catch (error)
    {
      // Sometimes, often at startup, Web Audio provides an empty buffer - causing TypeError on attempt to dereference
      if (!(error instanceof TypeError))
        throw(error);
    }
  }

  getOutputFrames_out (destChannelArrays, maxNumFramesToRead)
  {
    var frameDataByteOffset = 3092;
    var numDestChans = destChannelArrays.length;

    if (numDestChans < 1)
    {
      for (var frame = 0; frame < maxNumFramesToRead; ++frame)
      {
        for (var channel = 0; channel < numDestChans; ++channel)
        {
          destChannelArrays[channel][frame] = this._unpack_f32 (frameDataByteOffset);
          frameDataByteOffset += 4;
        }

        frameDataByteOffset += 4 * (1 - numDestChans);
      }
    }
    else
    {
      for (var frame = 0; frame < maxNumFramesToRead; ++frame)
      {
        for (var channel = 0; channel < 1; ++channel)
        {
          destChannelArrays[channel][frame] = this._unpack_f32 (frameDataByteOffset);
          frameDataByteOffset += 4;
        }
      }

      if (numDestChans > 1)
          for (var channel = 1; channel < numDestChans; ++channel)
          {
            const destination = destChannelArrays[channel];
            const source = destChannelArrays[1 - 1].subarray (0, destination.length);
            destChannelArrays[channel].set (source, 0);
          }
    }
  }

  //==============================================================================
  _pack_f32 (byteOffset, sourceValue)
  {
    this.memoryFloat32[(byteOffset) / 4] = sourceValue;
  }

  _pack_b (byteOffset, sourceValue)
  {
    this.memoryInt32[(byteOffset) / 4] = sourceValue ? 1 : 0;
  }

  _unpack_f32 (sourceOffset)
  {
    return this.memoryFloat32[(sourceOffset) / 4];
  }

  getWasmBytes()
  {
    return new Uint8Array([0,97,115,109,1,0,0,0,1,201,1,34,96,2,127,125,0,96,2,127,127,0,96,1,127,1,125,96,3,127,127,124,0,96,1,127,0,96,2,127,125,1,125,96,3,125,125,125,1,125,96,1,124,1,124,96,2,127,127,1,127,96,3,127,127,127,0,96,1,124,1,127,96,1,127,1,127,96,3,127,124,124,0,96,3,124,124,127,1,124,96,1,124,1,126,96,2,124,124,1,124,96,0,1,127,96,1,124,1,125,96,3,127,125,127,0,96,2,127,126,0,96,4,127,127,124,124,1,127,96,3,124,124,124,1,124,96,4,127,124,124,124,0,96,2,127,124,1,127,96,1,126,1,124,96,3,127,124,127,1,127,96,5,127,127,127,127,127,1,127,96,2,124,127,1,124,96,4,127,125,125,125,1,125,96,1,125,1,125,96,2,127,125,1,127,96,1,125,1,127,
        96,3,127,127,125,1,127,96,2,127,124,0,3,94,93,0,0,0,0,0,0,0,0,0,0,18,8,2,9,9,3,3,3,3,3,3,4,0,19,4,20,1,12,1,1,21,12,7,22,7,10,13,23,14,7,24,25,26,11,11,27,7,15,13,9,4,1,1,5,1,1,1,2,15,16,4,0,2,28,6,6,6,6,6,29,17,17,30,31,2,10,2,5,11,2,16,4,0,5,5,5,32,33,4,10,14,8,8,5,4,1,1,1,1,6,12,2,127,1,65,128,52,11,127,1,65,0,11,7,164,1,12,6,109,101,109,111,114,121,2,0,15,95,115,101,110,100,69,118,101,110,116,95,114,97,116,101,0,0,16,95,115,101,110,100,69,118,101,110,116,95,100,101,112,116,104,0,5,15,95,115,101,116,86,97,108,117,101,95,115,104,97,112,101,0,13,16,95,115,101,116,
        86,97,108,117,101,95,98,121,112,97,115,115,0,14,11,95,105,110,105,116,105,97,108,105,115,101,0,15,13,95,105,110,105,116,105,97,108,105,115,101,95,50,0,17,8,95,97,100,118,97,110,99,101,0,49,4,109,97,105,110,0,51,6,109,97,105,110,95,50,0,52,10,105,110,105,116,105,97,108,105,115,101,0,87,7,97,100,118,97,110,99,101,0,88,12,1,31,10,253,97,93,11,0,32,0,65,8,106,32,1,16,1,11,11,0,32,0,65,12,106,32,1,16,2,11,17,0,32,0,32,1,16,3,32,0,65,56,106,32,1,16,4,11,39,0,32,0,65,32,106,32,1,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,163,182,148,56,1,0,11,39,0,32,0,65,32,106,32,1,68,0,0,0,0,0,0,240,63,
        68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,163,182,148,56,1,0,11,11,0,32,0,65,8,106,32,1,16,6,11,11,0,32,0,65,12,106,32,1,16,7,11,29,0,32,0,32,1,67,10,215,35,60,148,16,8,32,0,65,56,106,32,1,67,10,215,35,60,148,16,9,11,29,0,32,0,32,1,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,16,89,65,50,16,91,16,10,11,29,0,32,0,32,1,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,16,89,65,50,16,91,16,10,11,56,0,65,1,32,2,16,11,33,2,32,0,65,4,106,32,1,56,1,0,32,0,65,8,106,32,1,32,0,16,12,147,32,2,178,149,56,1,0,32,0,65,12,106,32,2,54,1,0,32,0,32,1,56,1,0,11,19,0,2,127,32,0,32,1,
        74,4,127,32,0,5,32,1,11,15,11,11,27,0,32,0,42,1,0,32,0,65,8,106,42,1,0,32,0,65,12,106,40,1,0,178,148,147,15,11,90,0,32,2,65,0,70,4,64,65,1,33,2,11,32,0,65,192,1,106,65,8,106,40,1,0,65,0,70,4,64,32,0,32,0,40,1,0,65,1,106,54,1,0,11,32,0,65,192,1,106,65,4,106,32,1,42,1,0,32,0,65,192,1,106,42,1,0,147,32,2,178,149,56,1,0,32,0,65,192,1,106,65,8,106,32,2,54,1,0,11,16,0,32,0,65,204,1,106,32,1,65,4,252,10,0,0,11,13,0,32,0,65,8,106,32,1,32,2,16,16,11,27,0,65,28,32,1,54,1,0,65,16,32,2,57,1,0,32,0,65,12,106,32,1,32,2,16,17,11,56,0,32,0,65,48,106,65,1,54,1,
        0,32,0,32,1,32,2,16,18,32,0,65,56,106,65,48,106,65,2,54,1,0,32,0,65,56,106,32,1,32,2,16,19,32,0,65,240,0,106,32,1,32,2,16,20,11,104,0,65,28,32,1,54,1,0,65,16,32,2,57,1,0,32,0,65,32,106,65,36,42,1,0,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,163,182,148,56,1,0,32,0,65,36,106,67,0,0,240,66,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,163,65,60,183,163,182,148,56,1,0,32,0,16,21,11,104,0,65,28,32,1,54,1,0,65,16,32,2,57,1,0,32,0,65,32,106,65,52,42,1,0,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,
        163,182,148,56,1,0,32,0,65,36,106,67,0,0,240,66,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,163,65,60,183,163,182,148,56,1,0,32,0,16,24,11,86,1,1,127,35,0,34,3,65,36,106,36,0,2,64,65,28,32,1,54,1,0,65,16,32,2,57,1,0,32,0,65,36,106,65,1,54,1,0,32,0,32,3,65,228,4,40,1,0,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,68,0,0,0,0,0,0,73,64,16,25,65,36,252,10,0,0,11,32,3,36,0,11,31,0,32,0,65,44,42,1,0,16,22,32,0,65,40,106,32,0,65,48,106,40,1,0,65,200,3,106,172,16,23,11,42,0,32,0,32,1,56,1,0,32,0,65,4,106,32,1,56,1,0,32,0,65,8,106,67,0,0,
        0,0,56,1,0,32,0,65,12,106,65,0,54,1,0,11,24,0,32,0,32,1,32,1,65,32,172,136,132,65,255,255,255,255,7,172,131,55,1,0,11,31,0,32,0,65,60,42,1,0,16,22,32,0,65,40,106,32,0,65,48,106,40,1,0,65,200,3,106,172,16,23,11,74,1,2,127,35,0,34,4,65,200,0,106,36,0,2,127,32,4,65,36,106,65,0,65,36,252,11,0,32,4,65,36,106,32,1,16,26,32,4,65,36,106,32,2,32,3,16,27,32,0,32,4,65,36,106,65,36,252,10,0,0,32,0,12,0,11,33,5,32,4,36,0,32,5,11,66,1,1,127,2,64,65,0,33,2,2,64,3,64,32,2,65,1,78,4,64,12,2,11,32,0,65,12,106,32,2,65,24,108,106,32,1,16,28,2,64,32,2,65,1,106,33,2,11,12,0,11,0,
        11,11,65,0,4,64,32,0,32,1,16,29,11,11,153,2,2,2,127,2,124,32,2,68,0,0,0,0,0,0,0,0,32,1,68,184,30,133,235,81,184,222,63,162,16,30,33,2,65,0,4,64,32,0,32,1,32,2,16,31,2,64,65,0,33,3,2,64,3,64,32,3,65,1,78,4,64,12,2,11,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,0,64,32,3,183,68,0,0,0,0,0,0,240,63,160,68,24,45,68,84,251,33,9,64,162,68,0,0,0,0,0,0,0,64,163,16,32,162,163,33,5,32,0,65,12,106,32,3,65,24,108,106,32,1,32,2,32,5,16,33,2,64,32,3,65,1,106,33,3,11,12,0,11,0,11,11,5,2,64,65,0,33,4,2,64,3,64,32,4,65,1,78,4,64,12,2,11,68,0,0,0,0,0,0,240,
        63,68,0,0,0,0,0,0,0,64,68,0,0,0,0,0,0,0,64,32,4,183,162,68,0,0,0,0,0,0,240,63,160,68,24,45,68,84,251,33,9,64,162,68,0,0,0,0,0,0,16,64,163,16,32,162,163,33,6,32,0,65,12,106,32,4,65,24,108,106,32,1,32,2,32,6,16,33,2,64,32,4,65,1,106,33,4,11,12,0,11,0,11,11,11,11,12,0,32,0,65,20,106,32,1,54,1,0,11,12,0,32,0,65,8,106,32,1,54,1,0,11,27,0,32,0,32,2,100,4,124,32,2,5,32,0,32,1,99,4,124,32,1,5,32,0,11,11,15,11,101,1,2,124,32,2,68,0,0,0,0,0,0,0,0,32,1,68,184,30,133,235,81,184,222,63,162,16,30,33,2,68,0,0,0,0,0,0,224,63,32,1,163,33,3,68,0,0,0,0,0,
        0,0,64,32,1,162,68,24,45,68,84,251,33,25,64,32,2,162,32,3,162,16,34,162,32,3,162,33,4,32,0,32,4,68,0,0,0,0,0,0,240,63,32,4,160,163,182,56,1,0,11,158,2,2,2,127,1,124,35,0,34,2,65,40,106,36,0,2,124,32,0,16,35,65,255,255,255,255,7,113,33,1,32,1,65,251,195,164,255,3,76,4,64,32,1,65,158,193,154,242,3,72,4,64,68,0,0,0,0,0,0,240,63,12,2,11,32,0,68,0,0,0,0,0,0,0,0,16,47,12,1,11,32,1,65,128,128,192,255,7,78,4,64,32,0,32,0,161,12,1,11,32,2,65,20,106,32,2,32,0,16,37,65,20,252,10,0,0,32,2,65,20,106,40,1,0,65,3,113,65,0,70,4,64,32,2,65,20,106,65,4,106,43,1,0,32,2,65,20,106,65,
        12,106,43,1,0,16,47,12,1,11,32,2,65,20,106,40,1,0,65,3,113,65,1,70,4,64,32,2,65,20,106,65,4,106,43,1,0,32,2,65,20,106,65,12,106,43,1,0,65,1,16,48,154,12,1,11,32,2,65,20,106,40,1,0,65,3,113,65,2,70,4,64,32,2,65,20,106,65,4,106,43,1,0,32,2,65,20,106,65,12,106,43,1,0,16,47,154,12,1,11,32,2,65,20,106,65,4,106,43,1,0,32,2,65,20,106,65,12,106,43,1,0,65,1,16,48,12,0,11,33,3,32,2,36,0,32,3,11,156,1,1,3,124,32,2,68,0,0,0,0,0,0,0,0,32,1,68,184,30,133,235,81,184,222,63,162,16,30,33,2,68,0,0,0,0,0,0,224,63,32,1,163,33,4,68,0,0,0,0,0,0,0,64,32,1,162,68,24,45,68,84,
        251,33,25,64,32,2,162,32,4,162,16,34,162,32,4,162,33,5,68,0,0,0,0,0,0,240,63,32,3,163,33,6,32,0,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,32,6,32,5,162,160,32,5,32,5,162,160,163,182,56,1,0,32,0,65,4,106,32,5,182,56,1,0,32,0,65,8,106,32,5,32,6,160,182,56,1,0,11,157,1,2,2,127,1,124,35,0,34,2,65,40,106,36,0,2,124,32,0,16,35,65,255,255,255,255,7,113,33,1,32,1,65,251,195,164,255,3,76,4,64,32,1,65,128,128,128,242,3,72,4,64,32,0,12,2,11,32,0,68,0,0,0,0,0,0,0,0,65,0,16,36,12,1,11,32,1,65,128,128,192,255,7,78,4,64,32,0,32,0,161,12,1,11,32,2,65,20,106,32,2,32,0,16,37,
        65,20,252,10,0,0,32,2,65,20,106,65,4,106,43,1,0,32,2,65,20,106,65,12,106,43,1,0,32,2,65,20,106,40,1,0,65,1,113,16,36,12,0,11,33,3,32,2,36,0,32,3,11,11,0,32,0,189,65,32,172,135,167,15,11,239,4,2,23,124,3,127,68,99,85,85,85,85,85,213,63,33,3,68,122,254,16,17,17,17,193,63,33,4,68,254,65,179,27,186,161,171,63,33,5,68,55,214,6,132,244,100,150,63,33,6,68,147,132,110,233,227,38,130,63,33,7,68,40,3,86,201,34,109,109,63,33,8,68,21,131,224,254,200,219,87,63,33,9,68,1,101,242,242,216,68,67,63,33,10,68,104,16,141,26,247,38,48,63,33,11,68,166,146,55,160,136,126,20,63,33,12,68,233,167,240,50,15,184,18,63,33,13,68,115,83,96,219,203,117,243,
        190,33,14,68,212,122,191,116,112,42,251,62,33,15,68,24,45,68,84,251,33,233,63,33,16,68,7,92,20,51,38,166,129,60,33,17,32,0,16,35,33,26,32,26,65,255,255,255,255,7,113,65,168,168,150,255,3,78,33,27,65,0,33,28,32,27,4,64,32,26,65,31,117,65,0,71,33,28,32,28,4,64,32,0,154,33,0,32,1,154,33,1,11,68,24,45,68,84,251,33,233,63,32,0,161,68,7,92,20,51,38,166,129,60,32,1,161,160,33,0,68,0,0,0,0,0,0,0,0,33,1,11,32,0,32,0,162,33,18,32,18,32,18,162,33,19,68,122,254,16,17,17,17,193,63,32,19,68,55,214,6,132,244,100,150,63,32,19,68,40,3,86,201,34,109,109,63,32,19,68,1,101,242,242,216,68,67,63,32,19,68,166,146,55,160,136,126,20,63,32,19,
        68,115,83,96,219,203,117,243,190,162,160,162,160,162,160,162,160,162,160,33,20,32,18,68,254,65,179,27,186,161,171,63,32,19,68,147,132,110,233,227,38,130,63,32,19,68,21,131,224,254,200,219,87,63,32,19,68,104,16,141,26,247,38,48,63,32,19,68,233,167,240,50,15,184,18,63,32,19,68,212,122,191,116,112,42,251,62,162,160,162,160,162,160,162,160,162,160,162,33,21,32,18,32,0,162,33,22,32,1,32,18,32,22,32,20,32,21,160,162,32,1,160,162,160,32,22,68,99,85,85,85,85,85,213,63,162,160,33,20,32,0,32,20,160,33,19,32,27,4,64,65,1,65,2,32,2,108,107,183,33,22,32,22,68,0,0,0,0,0,0,0,64,32,0,32,20,32,19,32,19,162,32,19,32,22,160,163,161,160,162,161,33,21,32,28,4,124,32,21,154,5,
        32,21,11,15,26,11,32,2,65,0,70,4,64,32,19,15,26,11,32,19,33,23,32,23,16,39,33,23,32,20,32,23,32,0,161,161,33,21,68,0,0,0,0,0,0,240,191,32,19,163,33,24,32,24,16,39,33,25,32,25,32,24,68,0,0,0,0,0,0,240,63,32,25,32,23,162,160,32,25,32,21,162,160,162,160,15,11,158,12,3,5,127,14,124,1,126,35,0,34,2,65,152,3,106,36,0,2,127,68,0,0,64,84,251,33,249,63,33,7,68,49,99,98,26,97,180,208,61,33,8,32,1,189,33,21,32,21,65,63,172,135,65,0,172,82,33,3,32,21,65,32,172,135,65,255,255,255,255,7,172,131,167,33,4,68,0,0,0,0,0,0,0,0,33,9,32,4,65,250,212,189,128,4,76,4,64,32,4,65,255,255,63,113,65,251,195,36,70,4,64,32,
        0,32,2,65,20,106,32,1,32,4,16,41,65,20,252,10,0,0,32,0,12,2,11,32,4,65,252,178,139,128,4,76,4,64,32,3,69,4,64,32,1,68,0,0,64,84,251,33,249,63,161,33,9,32,9,68,49,99,98,26,97,180,208,61,161,33,10,32,2,65,40,106,65,1,54,1,0,32,2,65,40,106,65,4,106,32,10,57,1,0,32,2,65,40,106,65,12,106,32,9,32,10,161,68,49,99,98,26,97,180,208,61,161,57,1,0,32,0,32,2,65,40,106,65,20,252,10,0,0,32,0,12,3,11,32,1,68,0,0,64,84,251,33,249,63,160,33,9,32,9,68,49,99,98,26,97,180,208,61,160,33,11,32,2,65,60,106,65,127,54,1,0,32,2,65,60,106,65,4,106,32,11,57,1,0,32,2,65,60,106,65,12,106,32,9,32,11,161,68,49,99,
        98,26,97,180,208,61,160,57,1,0,32,0,32,2,65,60,106,65,20,252,10,0,0,32,0,12,2,5,32,3,69,4,64,32,1,68,0,0,64,84,251,33,9,64,161,33,9,32,9,68,49,99,98,26,97,180,224,61,161,33,12,32,2,65,208,0,106,65,2,54,1,0,32,2,65,208,0,106,65,4,106,32,12,57,1,0,32,2,65,208,0,106,65,12,106,32,9,32,12,161,68,49,99,98,26,97,180,224,61,161,57,1,0,32,0,32,2,65,208,0,106,65,20,252,10,0,0,32,0,12,3,11,32,1,68,0,0,64,84,251,33,9,64,160,33,9,32,9,68,49,99,98,26,97,180,224,61,160,33,13,32,2,65,228,0,106,65,126,54,1,0,32,2,65,228,0,106,65,4,106,32,13,57,1,0,32,2,65,228,0,106,65,12,106,32,9,32,13,161,68,49,
        99,98,26,97,180,224,61,160,57,1,0,32,0,32,2,65,228,0,106,65,20,252,10,0,0,32,0,12,2,11,0,11,32,4,65,187,140,241,128,4,76,4,64,32,4,65,188,251,215,128,4,76,4,64,32,4,65,252,178,203,128,4,70,4,64,32,0,32,2,65,248,0,106,32,1,32,4,16,41,65,20,252,10,0,0,32,0,12,3,11,32,3,69,4,64,32,1,68,0,0,48,127,124,217,18,64,161,33,9,32,9,68,202,148,147,167,145,14,233,61,161,33,14,32,2,65,140,1,106,65,3,54,1,0,32,2,65,140,1,106,65,4,106,32,14,57,1,0,32,2,65,140,1,106,65,12,106,32,9,32,14,161,68,202,148,147,167,145,14,233,61,161,57,1,0,32,0,32,2,65,140,1,106,65,20,252,10,0,0,32,0,12,3,11,32,1,68,0,0,48,127,
        124,217,18,64,160,33,9,32,9,68,202,148,147,167,145,14,233,61,160,33,15,32,2,65,160,1,106,65,125,54,1,0,32,2,65,160,1,106,65,4,106,32,15,57,1,0,32,2,65,160,1,106,65,12,106,32,9,32,15,161,68,202,148,147,167,145,14,233,61,160,57,1,0,32,0,32,2,65,160,1,106,65,20,252,10,0,0,32,0,12,2,11,32,4,65,251,195,228,128,4,70,4,64,32,0,32,2,65,180,1,106,32,1,32,4,16,41,65,20,252,10,0,0,32,0,12,2,11,32,3,69,4,64,32,1,68,0,0,64,84,251,33,25,64,161,33,9,32,9,68,49,99,98,26,97,180,240,61,161,33,16,32,2,65,200,1,106,65,4,54,1,0,32,2,65,200,1,106,65,4,106,32,16,57,1,0,32,2,65,200,1,106,65,12,106,32,9,32,16,161,68,
        49,99,98,26,97,180,240,61,161,57,1,0,32,0,32,2,65,200,1,106,65,20,252,10,0,0,32,0,12,2,11,32,1,68,0,0,64,84,251,33,25,64,160,33,9,32,9,68,49,99,98,26,97,180,240,61,160,33,17,32,2,65,220,1,106,65,124,54,1,0,32,2,65,220,1,106,65,4,106,32,17,57,1,0,32,2,65,220,1,106,65,12,106,32,9,32,17,161,68,49,99,98,26,97,180,240,61,160,57,1,0,32,0,32,2,65,220,1,106,65,20,252,10,0,0,32,0,12,1,11,32,4,65,251,195,228,137,4,72,4,64,32,0,32,2,65,240,1,106,32,1,32,4,16,41,65,20,252,10,0,0,32,0,12,1,11,32,4,65,128,128,192,255,7,78,4,64,32,2,65,132,2,106,65,0,54,1,0,32,2,65,132,2,106,65,4,106,32,1,32,1,
        161,57,1,0,32,2,65,132,2,106,65,12,106,32,1,32,1,161,57,1,0,32,0,32,2,65,132,2,106,65,20,252,10,0,0,32,0,12,1,11,32,21,66,255,255,255,255,255,255,255,7,131,66,128,128,128,128,128,128,128,176,193,0,132,191,33,9,32,9,16,89,183,33,18,32,9,32,18,161,68,0,0,0,0,0,0,112,65,162,33,9,32,9,16,89,183,33,19,32,9,32,19,161,68,0,0,0,0,0,0,112,65,162,33,9,32,9,33,20,32,20,65,0,183,98,4,127,65,3,5,32,19,65,0,183,98,4,127,65,2,5,32,18,65,0,183,98,4,127,65,1,5,65,0,11,11,11,33,5,32,2,65,152,2,106,65,0,106,32,18,57,1,0,32,2,65,152,2,106,65,8,106,32,19,57,1,0,32,2,65,152,2,106,65,2,65,8,108,106,32,20,
        57,1,0,32,2,65,196,2,106,32,2,65,152,2,106,65,24,252,10,0,0,32,2,65,220,2,106,32,2,65,176,2,106,32,2,65,196,2,106,32,4,65,20,118,65,150,8,107,32,5,65,1,16,42,65,20,252,10,0,0,32,3,4,64,32,2,65,240,2,106,65,0,32,2,65,220,2,106,40,1,0,107,54,1,0,32,2,65,240,2,106,65,4,106,32,2,65,220,2,106,65,4,106,43,1,0,154,57,1,0,32,2,65,240,2,106,65,12,106,32,2,65,220,2,106,65,12,106,43,1,0,154,57,1,0,32,0,32,2,65,240,2,106,65,20,252,10,0,0,32,0,12,1,11,32,2,65,132,3,106,32,2,65,220,2,106,65,4,252,10,0,0,32,2,65,132,3,106,65,4,106,32,2,65,220,2,106,65,4,106,65,8,252,10,0,0,32,2,65,132,3,
        106,65,12,106,32,2,65,220,2,106,65,12,106,65,8,252,10,0,0,32,0,32,2,65,132,3,106,65,20,252,10,0,0,32,0,12,0,11,33,6,32,2,36,0,32,6,11,5,0,66,0,15,11,14,0,32,0,189,66,128,128,128,128,112,131,191,15,11,12,0,68,0,0,0,0,0,0,0,0,15,11,164,3,2,5,127,13,124,35,0,34,3,65,40,106,36,0,2,127,68,0,0,0,0,0,0,56,67,33,8,68,131,200,201,109,48,95,228,63,33,9,68,0,0,64,84,251,33,249,63,33,10,68,49,99,98,26,97,180,208,61,33,11,68,0,0,96,26,97,180,208,61,33,12,68,115,112,3,46,138,25,163,59,33,13,68,0,0,0,46,138,25,163,59,33,14,68,193,73,32,37,154,131,123,57,33,15,32,1,68,131,200,201,109,48,95,228,63,162,68,0,
        0,0,0,0,0,56,67,160,68,0,0,0,0,0,0,56,67,161,33,16,32,16,16,89,33,4,32,1,32,16,68,0,0,64,84,251,33,249,63,162,161,33,17,32,16,68,49,99,98,26,97,180,208,61,162,33,18,32,17,32,18,161,33,19,32,19,189,65,52,172,135,65,255,15,172,131,167,33,5,32,2,65,20,118,33,6,32,6,32,5,107,65,16,74,4,64,32,17,33,20,32,16,68,0,0,96,26,97,180,208,61,162,33,18,32,20,32,18,161,33,17,32,16,68,115,112,3,46,138,25,163,59,162,32,20,32,17,161,32,18,161,161,33,18,32,17,32,18,161,33,19,32,19,189,65,52,172,135,65,255,15,172,131,167,33,5,32,6,32,5,107,65,49,74,4,64,32,17,33,20,32,16,68,0,0,0,46,138,25,163,59,162,33,18,32,20,32,18,161,33,17,
        32,16,68,193,73,32,37,154,131,123,57,162,32,20,32,17,161,32,18,161,161,33,18,32,17,32,18,161,33,19,11,11,32,3,65,20,106,32,4,54,1,0,32,3,65,20,106,65,4,106,32,19,57,1,0,32,3,65,20,106,65,12,106,32,17,32,19,161,32,18,161,57,1,0,32,0,32,3,65,20,106,65,20,252,10,0,0,32,0,12,0,11,33,7,32,3,36,0,32,7,11,243,17,2,31,127,7,124,35,0,34,5,65,196,6,106,36,0,2,127,32,5,65,20,106,65,208,2,65,136,2,252,10,0,0,32,5,65,156,2,106,65,252,5,65,192,0,252,10,0,0,32,5,65,220,2,106,65,0,65,128,1,252,11,0,32,5,65,220,3,106,65,0,65,128,1,252,11,0,32,5,65,220,4,106,65,0,65,128,1,252,11,0,65,3,32,4,106,33,6,32,
        3,65,1,107,33,7,65,0,32,2,65,3,107,65,24,16,91,16,11,33,8,32,2,65,24,32,8,65,1,106,108,107,33,9,2,64,32,8,32,7,107,33,10,32,7,32,6,106,33,11,2,64,65,0,33,12,2,64,3,64,32,12,32,11,76,4,64,1,5,12,2,11,32,5,65,220,2,106,32,12,65,15,113,65,8,108,106,32,10,65,0,72,4,124,68,0,0,0,0,0,0,0,0,5,32,5,65,20,106,32,10,16,43,65,4,108,106,40,1,0,183,11,57,1,0,32,10,65,1,106,33,10,2,64,32,12,65,1,106,33,12,11,12,0,11,0,11,11,11,2,64,65,0,33,13,2,64,3,64,32,13,32,6,76,4,64,1,5,12,2,11,68,0,0,0,0,0,0,0,0,33,36,2,64,65,0,33,14,2,64,3,64,32,14,32,3,72,4,64,1,5,
        12,2,11,32,36,32,1,32,14,16,44,65,8,108,106,43,1,0,32,5,65,220,2,106,32,7,32,13,106,32,14,107,65,15,113,65,8,108,106,43,1,0,162,160,33,36,2,64,32,14,65,1,106,33,14,11,12,0,11,0,11,11,32,5,65,220,4,106,32,13,65,15,113,65,8,108,106,32,36,57,1,0,2,64,32,13,65,1,106,33,13,11,12,0,11,0,11,11,65,0,33,15,65,0,33,16,32,6,33,17,68,0,0,0,0,0,0,0,0,33,37,32,5,65,220,5,106,65,0,65,192,0,252,11,0,2,64,3,64,2,64,32,5,65,220,4,106,32,17,65,15,113,65,8,108,106,43,1,0,33,37,2,64,68,0,0,0,0,0,0,0,0,33,38,65,0,33,18,2,64,32,17,33,19,2,64,3,64,32,19,65,0,74,4,64,1,5,12,2,11,68,
        0,0,0,0,0,0,112,62,32,37,162,16,89,183,33,38,32,5,65,220,5,106,32,18,65,15,113,65,4,108,106,32,37,68,0,0,0,0,0,0,112,65,32,38,162,161,16,89,54,1,0,32,18,65,1,106,33,18,32,5,65,220,4,106,32,19,65,1,107,65,15,113,65,8,108,106,43,1,0,32,38,160,33,37,2,64,32,19,65,127,106,33,19,11,12,0,11,0,11,11,11,32,37,32,9,16,45,33,37,32,37,68,0,0,0,0,0,0,32,64,32,37,68,0,0,0,0,0,0,192,63,162,156,162,161,33,37,32,37,16,89,33,15,32,37,32,15,183,161,33,37,65,0,33,16,32,9,65,0,74,4,64,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,40,1,0,33,20,32,20,65,24,32,9,107,117,33,21,32,15,32,21,106,33,
        15,32,20,32,21,65,24,32,9,107,116,107,33,20,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,32,20,54,1,0,32,20,65,23,32,9,107,117,33,16,5,32,9,65,0,70,4,64,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,40,1,0,65,23,117,33,16,5,32,37,68,0,0,0,0,0,0,224,63,102,4,64,65,2,33,16,11,11,11,32,16,65,0,74,4,64,32,15,65,1,106,33,15,65,0,33,22,2,64,65,0,33,23,2,64,3,64,32,23,32,17,72,4,64,1,5,12,2,11,32,5,65,220,5,106,32,23,65,15,113,65,4,108,106,40,1,0,33,24,32,22,69,4,64,32,24,65,0,71,4,64,65,1,33,22,32,5,65,220,5,106,32,23,65,15,113,65,4,108,106,65,128,128,128,8,32,24,
        107,54,1,0,11,5,32,5,65,220,5,106,32,23,65,15,113,65,4,108,106,65,255,255,255,7,32,24,107,54,1,0,11,2,64,32,23,65,1,106,33,23,11,12,0,11,0,11,11,32,9,65,0,74,4,64,32,9,65,1,70,4,64,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,40,1,0,65,255,255,255,3,113,54,1,0,5,32,9,65,2,70,4,64,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,32,5,65,220,5,106,32,17,65,1,107,65,15,113,65,4,108,106,40,1,0,65,255,255,255,1,113,54,1,0,11,11,11,32,16,65,2,70,4,64,68,0,0,0,0,0,0,240,63,32,37,161,33,37,32,22,4,64,32,37,68,0,0,0,
        0,0,0,240,63,32,9,16,45,161,33,37,11,11,11,32,37,68,0,0,0,0,0,0,0,0,97,4,64,65,0,33,25,2,64,32,17,65,1,107,33,26,2,64,3,64,32,26,32,6,78,4,64,1,5,12,2,11,32,25,32,5,65,220,5,106,32,26,65,15,113,65,4,108,106,40,1,0,114,33,25,2,64,32,26,65,127,106,33,26,11,12,0,11,0,11,11,32,25,65,0,70,4,64,65,1,33,27,2,64,3,64,32,5,65,220,5,106,32,6,32,27,107,65,15,113,65,4,108,106,40,1,0,65,0,70,4,64,1,5,12,2,11,32,27,65,1,106,33,27,12,0,11,0,11,2,64,32,17,65,1,106,33,28,2,64,3,64,32,28,32,17,32,27,106,76,4,64,1,5,12,2,11,32,5,65,220,2,106,32,7,32,28,106,65,15,113,65,8,108,106,
        32,5,65,20,106,32,8,32,28,106,16,43,65,4,108,106,40,1,0,183,57,1,0,68,0,0,0,0,0,0,0,0,33,39,2,64,65,0,33,29,2,64,3,64,32,29,32,3,72,4,64,1,5,12,2,11,32,39,32,1,32,29,16,44,65,8,108,106,43,1,0,32,5,65,220,2,106,32,7,32,28,106,32,29,107,65,15,113,65,8,108,106,43,1,0,162,160,33,39,2,64,32,29,65,1,106,33,29,11,12,0,11,0,11,11,32,5,65,220,4,106,32,28,65,15,113,65,8,108,106,32,39,57,1,0,2,64,32,28,65,1,106,33,28,11,12,0,11,0,11,11,32,17,32,27,106,33,17,12,2,11,11,12,2,11,12,0,11,0,11,32,37,68,0,0,0,0,0,0,0,0,97,4,64,32,17,65,127,106,33,17,32,9,65,24,107,33,9,2,64,3,
        64,32,5,65,220,5,106,32,17,65,15,113,65,4,108,106,40,1,0,65,0,70,4,64,1,5,12,2,11,32,17,65,127,106,33,17,32,9,65,24,107,33,9,12,0,11,0,11,5,32,37,65,0,32,9,107,16,45,33,37,32,37,68,0,0,0,0,0,0,112,65,102,4,64,68,0,0,0,0,0,0,112,62,32,37,162,16,89,183,33,40,32,5,65,220,5,106,32,17,65,15,113,65,4,108,106,32,37,68,0,0,0,0,0,0,112,65,32,40,162,161,16,89,54,1,0,32,17,65,1,106,33,17,32,9,65,24,106,33,9,32,5,65,220,5,106,32,17,65,15,113,65,4,108,106,32,40,16,89,54,1,0,5,32,5,65,220,5,106,32,17,65,15,113,65,4,108,106,32,37,16,89,54,1,0,11,11,68,0,0,0,0,0,0,240,63,32,9,16,45,33,
        41,2,64,32,17,33,30,2,64,3,64,32,30,65,0,78,4,64,1,5,12,2,11,32,5,65,220,4,106,32,30,65,15,113,65,8,108,106,32,41,32,5,65,220,5,106,32,30,65,15,113,65,4,108,106,40,1,0,183,162,57,1,0,32,41,68,0,0,0,0,0,0,112,62,162,33,41,2,64,32,30,65,127,106,33,30,11,12,0,11,0,11,11,2,64,32,17,33,31,2,64,3,64,32,31,65,0,78,4,64,1,5,12,2,11,68,0,0,0,0,0,0,0,0,33,41,2,64,65,0,33,32,2,64,3,64,32,32,32,6,76,4,127,32,32,32,17,32,31,107,76,5,65,0,11,4,64,1,5,12,2,11,32,41,32,5,65,156,2,106,32,32,65,7,113,65,8,108,106,43,1,0,32,5,65,220,4,106,32,31,32,32,106,65,15,113,65,8,108,106,43,
        1,0,162,160,33,41,2,64,32,32,65,1,106,33,32,11,12,0,11,0,11,11,32,5,65,220,3,106,32,17,32,31,107,65,15,113,65,8,108,106,32,41,57,1,0,2,64,32,31,65,127,106,33,31,11,12,0,11,0,11,11,68,0,0,0,0,0,0,0,0,33,41,2,64,32,17,33,33,2,64,3,64,32,33,65,0,78,4,64,1,5,12,2,11,32,41,32,5,65,220,3,106,32,33,65,15,113,65,8,108,106,43,1,0,160,33,41,2,64,32,33,65,127,106,33,33,11,12,0,11,0,11,11,32,16,65,0,70,4,124,32,41,5,32,41,154,11,33,42,32,4,65,0,70,4,64,32,5,65,156,6,106,32,15,65,7,113,54,1,0,32,5,65,156,6,106,65,4,106,32,42,57,1,0,32,5,65,156,6,106,65,12,106,68,0,0,0,0,0,0,0,
        0,57,1,0,32,0,32,5,65,156,6,106,65,20,252,10,0,0,32,0,12,1,11,32,5,65,220,3,106,65,0,106,43,1,0,32,41,161,33,41,2,64,65,1,33,34,2,64,3,64,32,34,32,17,76,4,64,1,5,12,2,11,32,41,32,5,65,220,3,106,32,34,65,15,113,65,8,108,106,43,1,0,160,33,41,2,64,32,34,65,1,106,33,34,11,12,0,11,0,11,11,32,5,65,176,6,106,32,15,65,7,113,54,1,0,32,5,65,176,6,106,65,4,106,32,42,57,1,0,32,5,65,176,6,106,65,12,106,32,16,65,0,70,4,124,32,41,5,32,41,154,11,57,1,0,32,0,32,5,65,176,6,106,65,20,252,10,0,0,32,0,12,0,11,33,35,32,5,36,0,32,35,11,31,1,1,127,32,0,65,194,0,16,92,33,1,32,1,65,0,72,
        4,127,32,1,65,194,0,106,5,32,1,11,15,11,29,1,1,127,32,0,65,3,16,92,33,1,32,1,65,0,72,4,127,32,1,65,3,106,5,32,1,11,15,11,171,1,0,32,1,65,255,7,74,4,64,32,0,68,0,0,0,0,0,0,224,127,162,33,0,32,1,65,255,7,107,33,1,32,1,65,255,7,74,4,64,32,0,68,0,0,0,0,0,0,224,127,162,33,0,32,1,65,255,7,107,33,1,32,1,65,255,7,74,4,64,65,255,7,33,1,11,11,5,32,1,65,130,120,72,4,64,32,0,68,0,0,0,0,0,0,96,3,162,33,0,32,1,65,201,7,106,33,1,32,1,65,130,120,72,4,64,32,0,68,0,0,0,0,0,0,96,3,162,33,0,32,1,65,201,7,106,33,1,32,1,65,130,120,72,4,64,65,130,120,33,1,11,11,11,11,32,
        0,65,255,7,32,1,106,172,65,52,172,134,191,162,15,11,43,1,1,124,32,0,16,90,185,33,1,32,1,32,0,97,4,64,32,0,15,26,11,32,0,65,0,183,102,4,64,32,1,15,26,11,32,1,65,1,183,161,15,11,225,1,1,11,124,68,76,85,85,85,85,85,165,63,33,2,68,119,81,193,22,108,193,86,191,33,3,68,144,21,203,25,160,1,250,62,33,4,68,173,82,156,128,79,126,146,190,33,5,68,196,177,180,189,158,238,33,62,33,6,68,212,56,136,190,233,250,168,189,33,7,32,0,32,0,162,33,8,32,8,32,8,162,33,9,32,8,68,76,85,85,85,85,85,165,63,32,8,68,119,81,193,22,108,193,86,191,32,8,68,144,21,203,25,160,1,250,62,162,160,162,160,162,32,9,32,9,162,68,173,82,156,128,79,126,146,190,32,8,68,196,
        177,180,189,158,238,33,62,32,8,68,212,56,136,190,233,250,168,189,162,160,162,160,162,160,33,10,68,0,0,0,0,0,0,224,63,32,8,162,33,11,68,0,0,0,0,0,0,240,63,32,11,161,33,12,32,12,68,0,0,0,0,0,0,240,63,32,12,161,32,11,161,32,8,32,10,162,32,0,32,1,162,161,160,160,15,11,228,1,1,10,124,68,73,85,85,85,85,85,197,191,33,3,68,166,248,16,17,17,17,129,63,33,4,68,213,97,193,25,160,1,42,191,33,5,68,125,254,177,87,227,29,199,62,33,6,68,235,156,43,138,230,229,90,190,33,7,68,124,213,207,90,58,217,229,61,33,8,32,0,32,0,162,33,9,32,9,32,9,162,33,10,68,166,248,16,17,17,17,129,63,32,9,68,213,97,193,25,160,1,42,191,32,9,68,125,254,177,87,227,29,199,
        62,162,160,162,160,32,9,32,10,162,68,235,156,43,138,230,229,90,190,32,9,68,124,213,207,90,58,217,229,61,162,160,162,160,33,11,32,9,32,0,162,33,12,32,2,65,0,70,4,124,32,0,32,12,68,73,85,85,85,85,85,197,191,32,9,32,11,162,160,162,160,5,32,0,32,9,68,0,0,0,0,0,0,224,63,32,1,162,32,12,32,11,162,161,162,32,1,161,32,12,68,73,85,85,85,85,85,197,191,162,161,161,11,15,11,200,1,1,1,127,35,0,34,3,65,8,106,36,0,2,64,2,64,3,64,32,0,65,4,106,40,1,0,32,2,70,4,64,12,2,11,32,0,40,1,0,65,0,71,4,64,32,0,16,50,32,0,65,8,106,65,176,1,106,32,0,65,192,1,106,65,4,252,10,0,0,11,32,0,65,8,106,65,180,1,106,32,0,65,204,1,
        106,65,4,252,10,0,0,32,3,65,0,65,8,252,11,0,32,3,32,1,32,0,65,4,106,40,1,0,65,4,108,106,65,4,252,10,0,0,32,0,65,8,106,32,3,16,51,32,1,65,128,16,106,32,0,65,4,106,40,1,0,65,4,108,106,32,3,65,4,106,65,4,252,10,0,0,32,0,65,4,106,32,0,65,4,106,40,1,0,65,1,106,54,1,0,12,0,11,0,11,32,0,65,4,106,65,0,54,1,0,11,32,3,36,0,11,109,0,32,0,65,192,1,106,65,8,106,40,1,0,65,0,71,4,64,32,0,65,192,1,106,32,0,65,192,1,106,42,1,0,32,0,65,192,1,106,65,4,106,42,1,0,146,56,1,0,32,0,65,192,1,106,65,8,106,32,0,65,192,1,106,65,8,106,40,1,0,65,127,106,54,1,0,32,0,65,192,1,106,65,8,
        106,40,1,0,65,0,70,4,64,32,0,32,0,40,1,0,65,127,106,54,1,0,11,11,11,104,1,1,127,35,0,34,2,65,4,106,36,0,2,64,32,2,65,0,65,4,252,11,0,2,64,32,0,65,12,106,65,160,1,106,32,0,65,176,1,106,65,4,252,10,0,0,11,32,0,65,12,106,32,2,16,52,2,64,32,1,65,4,106,32,1,65,4,106,42,1,0,32,0,65,180,1,106,40,1,0,32,2,42,1,0,16,53,32,1,42,1,0,148,146,56,1,0,11,11,32,2,36,0,11,197,1,1,1,127,35,0,34,2,65,16,106,36,0,2,64,32,2,65,0,65,4,252,11,0,32,2,65,4,106,65,0,65,4,252,11,0,32,2,65,8,106,65,0,65,8,252,11,0,2,64,11,32,0,32,2,16,54,2,64,11,32,0,65,56,106,32,2,65,4,106,
        16,55,2,64,32,2,65,8,106,32,2,65,8,106,42,1,0,32,2,65,4,106,42,1,0,32,0,65,160,1,106,42,1,0,148,67,10,215,35,60,148,146,56,1,0,11,32,0,65,240,0,106,32,2,65,8,106,16,56,2,64,32,1,32,1,42,1,0,32,2,42,1,0,67,0,0,128,63,32,0,65,160,1,106,42,1,0,67,10,215,35,60,148,147,148,146,56,1,0,32,1,32,1,42,1,0,32,2,65,8,106,65,4,106,42,1,0,146,56,1,0,11,11,32,2,36,0,11,29,0,32,0,4,125,67,0,0,128,63,15,5,67,0,0,0,63,32,1,67,0,0,0,63,148,146,15,11,11,235,1,3,1,127,1,124,1,125,32,0,65,52,106,40,1,0,33,2,32,2,65,127,70,4,64,15,11,2,64,3,64,32,2,65,1,72,4,64,32,1,32,1,
        42,1,0,32,0,16,57,146,56,1,0,65,252,4,40,1,0,4,64,65,132,5,40,1,0,65,140,5,40,1,0,113,4,64,32,0,65,16,106,32,0,65,16,106,43,1,0,32,0,65,36,106,42,1,0,187,160,57,1,0,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,163,33,3,32,0,65,16,106,43,1,0,32,3,16,58,32,3,163,182,33,4,32,4,32,0,65,24,106,42,1,0,93,4,127,16,59,5,65,0,11,4,64,32,0,16,60,11,32,0,65,24,106,32,4,56,1,0,5,32,0,32,0,65,36,106,42,1,0,65,148,5,42,1,0,148,16,61,11,5,32,0,32,0,65,32,106,42,1,0,16,61,11,32,0,65,52,106,65,1,54,1,0,15,5,65,0,33,2,11,12,0,11,0,11,0,11,235,1,3,1,127,1,124,
        1,125,32,0,65,52,106,40,1,0,33,2,32,2,65,127,70,4,64,15,11,2,64,3,64,32,2,65,1,72,4,64,32,1,32,1,42,1,0,32,0,16,79,146,56,1,0,65,172,5,40,1,0,4,64,65,180,5,40,1,0,65,188,5,40,1,0,113,4,64,32,0,65,16,106,32,0,65,16,106,43,1,0,32,0,65,36,106,42,1,0,187,160,57,1,0,68,0,0,0,0,0,0,240,63,68,0,0,0,0,0,0,240,63,163,33,3,32,0,65,16,106,43,1,0,32,3,16,58,32,3,163,182,33,4,32,4,32,0,65,24,106,42,1,0,93,4,127,16,80,5,65,0,11,4,64,32,0,16,81,11,32,0,65,24,106,32,4,56,1,0,5,32,0,32,0,65,36,106,42,1,0,65,196,5,42,1,0,148,16,82,11,5,32,0,32,0,65,32,106,42,
        1,0,16,82,11,32,0,65,52,106,65,1,54,1,0,15,5,65,0,33,2,11,12,0,11,0,11,0,11,219,1,1,1,127,32,0,65,44,106,40,1,0,33,2,32,2,65,127,70,4,64,15,11,2,64,3,64,32,2,65,1,72,4,64,32,0,65,36,106,40,1,0,4,64,32,0,65,204,5,40,1,0,16,26,32,0,68,0,0,0,0,0,0,240,63,65,16,43,1,0,162,68,0,0,0,0,0,0,73,64,16,27,32,0,65,36,106,65,0,54,1,0,11,11,2,64,32,2,65,1,72,4,64,32,0,65,40,106,65,220,5,65,4,252,10,0,0,11,2,64,3,64,32,2,65,1,72,4,64,32,0,65,40,106,32,0,65,40,106,40,1,0,65,127,106,54,1,0,32,0,65,40,106,40,1,0,65,0,72,4,64,12,3,11,32,1,65,4,106,32,1,
        65,4,106,42,1,0,32,0,32,1,42,1,0,16,83,146,56,1,0,32,0,65,44,106,65,1,54,1,0,15,5,65,0,33,2,11,12,0,11,0,11,11,12,0,11,0,11,0,11,60,1,1,125,32,0,16,62,33,1,16,59,4,64,32,0,65,28,106,42,1,0,32,1,148,65,244,4,42,1,0,146,15,26,11,65,236,4,40,1,0,32,0,65,24,106,42,1,0,32,1,65,244,4,42,1,0,16,63,15,11,217,4,2,7,126,2,127,32,0,189,33,2,32,1,189,33,3,32,2,65,52,172,135,65,255,15,172,131,167,33,9,32,3,65,52,172,135,65,255,15,172,131,167,33,10,32,2,66,128,128,128,128,128,128,128,128,128,127,131,33,4,32,3,65,1,172,134,65,0,172,81,4,127,65,1,5,32,1,16,75,11,4,127,65,1,5,32,9,65,255,15,
        70,11,4,64,32,0,32,1,162,32,0,32,1,162,163,15,26,11,32,2,66,255,255,255,255,255,255,255,255,255,0,131,32,3,66,255,255,255,255,255,255,255,255,255,0,131,87,4,64,32,2,65,1,172,134,32,3,65,1,172,134,81,4,64,65,0,183,32,0,162,15,26,11,32,0,15,26,11,32,9,65,0,70,4,64,2,64,32,2,65,12,172,134,33,5,2,64,3,64,32,5,65,63,172,135,65,0,172,81,4,64,1,5,12,2,11,32,9,65,127,106,33,9,2,64,32,5,65,1,172,134,33,5,11,12,0,11,0,11,11,32,2,65,0,32,9,107,65,1,106,172,134,33,2,5,32,2,66,255,255,255,255,255,255,255,7,131,33,2,32,2,66,128,128,128,128,128,128,128,8,132,33,2,11,32,10,65,0,70,4,64,2,64,32,3,65,12,172,134,33,6,
        2,64,3,64,32,6,65,63,172,135,65,0,172,81,4,64,1,5,12,2,11,32,10,65,127,106,33,10,2,64,32,6,65,1,172,134,33,6,11,12,0,11,0,11,11,32,3,65,0,32,10,107,65,1,106,172,134,33,3,5,32,3,66,255,255,255,255,255,255,255,7,131,33,3,32,3,66,128,128,128,128,128,128,128,8,132,33,3,11,2,64,3,64,32,9,32,10,74,4,64,1,5,12,2,11,32,2,32,3,125,33,7,32,7,65,63,172,135,65,0,172,81,4,64,32,7,65,0,172,81,4,64,65,0,183,32,0,162,15,26,11,32,7,33,2,11,32,2,65,1,172,134,33,2,2,64,32,9,65,127,106,33,9,11,12,0,11,0,11,32,2,32,3,125,33,8,32,8,65,63,172,135,65,0,172,81,4,64,32,8,65,0,172,81,4,64,65,0,183,32,0,
        162,15,26,11,32,8,33,2,11,2,64,3,64,32,2,65,52,172,135,65,0,172,81,4,64,1,5,12,2,11,32,9,65,127,106,33,9,2,64,32,2,65,1,172,134,33,2,11,12,0,11,0,11,32,9,65,0,74,4,64,32,2,66,128,128,128,128,128,128,128,8,125,33,2,32,2,32,9,172,65,52,172,134,132,33,2,5,32,2,65,0,32,9,107,65,1,106,172,135,33,2,11,32,2,32,4,132,191,15,11,12,0,65,236,4,40,1,0,65,5,70,15,11,17,0,32,0,65,28,106,32,0,65,40,106,16,76,56,1,0,11,82,0,32,0,65,24,106,32,0,65,24,106,42,1,0,32,1,146,56,1,0,2,64,3,64,32,0,65,24,106,42,1,0,67,0,0,128,63,96,4,64,1,5,12,2,11,32,0,65,24,106,32,0,65,24,106,42,1,0,67,
        0,0,128,63,147,56,1,0,16,59,4,64,32,0,16,60,11,12,0,11,0,11,11,47,0,32,0,65,12,106,40,1,0,65,0,74,4,64,32,0,65,12,106,32,0,65,12,106,40,1,0,65,127,106,54,1,0,32,0,16,12,15,26,11,32,0,42,1,0,15,11,83,0,32,0,65,1,70,4,64,32,1,32,2,32,3,16,64,15,26,11,32,0,65,2,70,4,64,32,1,32,2,32,3,16,65,15,26,11,32,0,65,3,70,4,64,32,1,32,2,32,3,16,66,15,26,11,32,0,65,4,70,4,64,32,1,32,2,32,3,16,67,15,26,11,32,1,32,2,32,3,16,68,15,11,48,1,1,125,32,0,65,4,178,32,1,148,148,33,3,32,0,67,0,0,0,63,94,4,125,32,2,32,1,65,3,178,148,146,32,3,147,5,32,2,32,1,147,32,3,146,
        11,15,11,25,0,32,0,67,0,0,0,63,94,4,125,32,2,32,1,147,5,32,2,32,1,146,11,15,11,20,0,32,2,32,1,147,32,0,67,0,0,0,64,32,1,148,148,146,15,11,20,0,32,2,32,1,146,32,0,67,0,0,0,64,32,1,148,148,147,15,11,19,0,32,0,67,219,15,201,64,148,16,69,32,1,148,32,2,146,15,11,234,3,3,4,124,3,127,1,125,35,0,34,7,65,24,106,36,0,2,125,68,24,45,68,84,251,33,249,63,33,1,68,24,45,68,84,251,33,9,64,33,2,68,210,33,51,127,124,217,18,64,33,3,68,24,45,68,84,251,33,25,64,33,4,32,0,188,33,5,32,5,33,6,32,5,65,255,255,255,255,7,113,33,5,32,5,65,218,159,164,250,3,76,4,64,32,5,65,128,128,128,204,3,72,4,125,32,0,5,32,
        0,187,16,70,11,12,1,11,32,5,65,209,167,237,131,4,76,4,64,32,5,65,227,151,219,128,4,76,4,64,32,6,65,31,117,65,0,71,4,125,32,0,187,68,24,45,68,84,251,33,249,63,160,16,71,140,5,32,0,187,68,24,45,68,84,251,33,249,63,161,16,71,11,12,2,11,32,6,65,31,117,65,0,71,4,124,32,0,187,68,24,45,68,84,251,33,9,64,160,154,5,32,0,187,68,24,45,68,84,251,33,9,64,161,154,11,16,70,12,1,11,32,5,65,213,227,136,135,4,76,4,64,32,5,65,223,219,191,133,4,76,4,64,32,6,65,31,117,65,0,71,4,125,32,0,187,68,210,33,51,127,124,217,18,64,160,16,71,5,32,0,187,68,210,33,51,127,124,217,18,64,161,16,71,140,11,12,2,11,32,6,65,31,117,65,0,71,4,124,32,0,
        187,68,24,45,68,84,251,33,25,64,160,5,32,0,187,68,24,45,68,84,251,33,25,64,161,11,16,70,12,1,11,32,5,65,128,128,128,252,7,78,4,64,32,0,32,0,147,12,1,11,32,7,65,12,106,32,7,32,0,16,72,65,12,252,10,0,0,32,7,65,12,106,40,1,0,65,0,70,4,64,32,7,65,12,106,65,4,106,43,1,0,16,70,12,1,11,32,7,65,12,106,40,1,0,65,1,70,4,64,32,7,65,12,106,65,4,106,43,1,0,16,71,12,1,11,32,7,65,12,106,40,1,0,65,2,70,4,64,32,7,65,12,106,65,4,106,43,1,0,154,16,70,12,1,11,32,7,65,12,106,65,4,106,43,1,0,16,71,140,12,0,11,33,8,32,7,36,0,32,8,11,132,1,1,8,124,68,119,172,203,84,85,85,197,191,33,1,68,178,251,110,
        137,16,17,129,63,33,2,68,116,231,202,226,249,0,42,191,33,3,68,167,70,59,140,135,205,198,62,33,4,32,0,32,0,162,33,5,32,5,32,5,162,33,6,68,116,231,202,226,249,0,42,191,32,5,68,167,70,59,140,135,205,198,62,162,160,33,7,32,5,32,0,162,33,8,32,0,32,8,68,119,172,203,84,85,85,197,191,32,5,68,178,251,110,137,16,17,129,63,162,160,162,160,32,8,32,6,162,32,7,162,160,182,15,11,132,1,1,7,124,68,129,94,12,253,255,255,223,191,33,1,68,66,58,5,225,83,85,165,63,33,2,68,39,30,15,232,135,192,86,191,33,3,68,105,80,238,224,66,147,249,62,33,4,32,0,32,0,162,33,5,32,5,32,5,162,33,6,68,39,30,15,232,135,192,86,191,32,5,68,105,80,238,224,66,147,249,62,162,160,33,7,
        68,0,0,0,0,0,0,240,63,32,5,68,129,94,12,253,255,255,223,191,162,160,32,6,68,66,58,5,225,83,85,165,63,162,160,32,6,32,5,162,32,7,162,160,182,15,11,239,3,2,5,127,5,124,35,0,34,2,65,148,1,106,36,0,2,127,68,0,0,0,0,0,0,56,67,33,7,68,131,200,201,109,48,95,228,63,33,8,68,0,0,0,80,251,33,249,63,33,9,68,99,98,26,97,180,16,81,62,33,10,32,1,188,33,3,32,3,65,255,255,255,255,7,113,33,4,32,4,65,219,159,164,238,4,72,4,64,32,1,187,68,131,200,201,109,48,95,228,63,162,68,0,0,0,0,0,0,56,67,160,68,0,0,0,0,0,0,56,67,161,33,11,32,2,65,12,106,32,11,16,89,65,3,113,54,1,0,32,2,65,12,106,65,4,106,32,1,187,32,11,68,
        0,0,0,80,251,33,249,63,162,161,32,11,68,99,98,26,97,180,16,81,62,162,161,57,1,0,32,0,32,2,65,12,106,65,12,252,10,0,0,32,0,12,1,11,32,4,65,128,128,128,252,7,78,4,64,32,2,65,24,106,65,0,54,1,0,32,2,65,24,106,65,4,106,32,1,32,1,147,187,57,1,0,32,0,32,2,65,24,106,65,12,252,10,0,0,32,0,12,1,11,32,4,65,23,117,65,150,1,107,33,5,32,2,65,36,106,65,0,65,24,252,11,0,32,2,65,36,106,65,0,106,32,4,32,5,65,23,116,107,190,187,57,1,0,32,2,65,208,0,106,32,2,65,36,106,65,24,252,10,0,0,32,2,65,232,0,106,32,2,65,60,106,32,2,65,208,0,106,32,5,65,1,65,0,16,42,65,20,252,10,0,0,32,3,65,31,117,65,0,71,4,
        64,32,2,65,252,0,106,65,0,32,2,65,232,0,106,40,1,0,107,65,3,113,54,1,0,32,2,65,252,0,106,65,4,106,32,2,65,232,0,106,65,4,106,43,1,0,154,57,1,0,32,0,32,2,65,252,0,106,65,12,252,10,0,0,32,0,12,1,11,32,2,65,136,1,106,32,2,65,232,0,106,40,1,0,65,3,113,54,1,0,32,2,65,136,1,106,65,4,106,32,2,65,232,0,106,65,4,106,65,8,252,10,0,0,32,0,32,2,65,136,1,106,65,12,252,10,0,0,32,0,12,0,11,33,6,32,2,36,0,32,6,11,5,0,65,0,15,11,8,0,67,0,0,0,0,15,11,33,0,2,127,32,0,189,66,255,255,255,255,255,255,255,255,255,0,131,66,128,128,128,128,128,128,128,248,255,0,85,15,11,11,18,0,32,0,67,0,0,0,64,16,
        77,67,0,0,128,63,147,15,11,17,0,32,1,67,0,0,0,48,148,32,0,16,78,178,148,15,11,49,1,1,126,32,0,41,1,0,66,237,156,153,142,4,126,66,185,224,0,124,65,255,255,255,255,7,172,131,33,1,32,0,32,1,55,1,0,32,1,167,65,255,255,255,255,7,113,15,11,60,1,1,125,32,0,16,62,33,1,16,80,4,64,32,0,65,28,106,42,1,0,32,1,148,65,164,5,42,1,0,146,15,26,11,65,156,5,40,1,0,32,0,65,24,106,42,1,0,32,1,65,164,5,42,1,0,16,63,15,11,12,0,65,156,5,40,1,0,65,5,70,15,11,17,0,32,0,65,28,106,32,0,65,40,106,16,76,56,1,0,11,82,0,32,0,65,24,106,32,0,65,24,106,42,1,0,32,1,146,56,1,0,2,64,3,64,32,0,65,24,106,42,1,
        0,67,0,0,128,63,96,4,64,1,5,12,2,11,32,0,65,24,106,32,0,65,24,106,42,1,0,67,0,0,128,63,147,56,1,0,16,80,4,64,32,0,16,81,11,12,0,11,0,11,11,73,1,1,127,2,64,65,0,33,2,2,64,3,64,32,2,65,1,78,4,64,12,2,11,32,0,65,12,106,32,2,65,24,108,106,32,1,16,84,33,1,2,64,32,2,65,1,106,33,2,11,12,0,11,0,11,11,65,0,4,64,32,0,32,1,16,85,33,1,11,32,1,15,11,123,2,1,127,1,125,35,0,34,2,65,24,106,36,0,2,125,32,2,65,12,106,32,2,32,0,32,1,16,86,65,12,252,10,0,0,32,0,65,20,106,40,1,0,65,228,5,40,1,0,70,4,64,32,2,65,12,106,65,0,106,42,1,0,12,1,11,32,0,65,20,106,40,1,0,65,
        236,5,40,1,0,70,4,64,32,2,65,12,106,65,4,106,42,1,0,12,1,11,32,2,65,12,106,65,2,65,4,108,106,42,1,0,12,0,11,33,3,32,2,36,0,32,3,11,77,1,2,125,32,0,42,1,0,32,1,32,0,65,4,106,42,1,0,147,148,33,2,32,2,32,0,65,4,106,42,1,0,146,33,3,32,0,65,4,106,32,2,32,3,146,56,1,0,32,0,65,8,106,40,1,0,65,244,5,40,1,0,70,4,64,32,3,15,26,11,32,1,32,3,147,15,11,228,1,2,2,127,3,125,35,0,34,3,65,24,106,36,0,2,127,32,2,32,1,65,8,106,42,1,0,32,1,65,12,106,65,0,106,42,1,0,148,147,32,1,65,12,106,65,4,106,42,1,0,147,32,1,42,1,0,148,33,5,32,1,65,4,106,42,1,0,32,5,148,32,1,65,
        12,106,65,0,106,42,1,0,146,33,6,32,1,65,4,106,42,1,0,32,6,148,32,1,65,12,106,65,4,106,42,1,0,146,33,7,32,1,65,12,106,65,0,106,32,1,65,4,106,42,1,0,32,5,148,32,6,146,56,1,0,32,1,65,12,106,65,4,106,32,1,65,4,106,42,1,0,32,6,148,32,7,146,56,1,0,32,3,65,12,106,65,0,106,32,7,56,1,0,32,3,65,12,106,65,4,106,32,5,56,1,0,32,3,65,12,106,65,2,65,4,108,106,32,6,56,1,0,32,0,32,3,65,12,106,65,12,252,10,0,0,32,0,12,0,11,33,4,32,3,36,0,32,4,11,11,0,65,192,6,32,0,32,1,16,15,11,12,0,65,192,6,65,148,8,32,0,16,49,11,64,0,32,0,32,0,98,4,127,65,128,128,128,128,120,5,32,0,68,0,0,
        0,0,0,0,224,65,102,4,127,65,128,128,128,128,120,5,32,0,68,0,0,32,0,0,0,224,193,101,4,127,65,128,128,128,128,120,5,32,0,170,11,11,11,11,79,0,32,0,32,0,98,4,126,66,128,128,128,128,128,128,128,128,128,127,5,32,0,68,0,0,0,0,0,0,224,67,102,4,126,66,128,128,128,128,128,128,128,128,128,127,5,32,0,68,0,0,0,0,0,0,224,195,101,4,126,66,128,128,128,128,128,128,128,128,128,127,5,32,0,176,11,11,11,11,37,0,32,1,69,4,127,65,0,5,32,0,65,128,128,128,128,120,70,32,1,65,127,70,113,4,127,65,0,5,32,0,32,1,109,11,11,11,16,0,32,1,69,4,127,65,0,5,32,0,32,1,111,11,11,11,193,41,31,0,65,16,11,12,0,0,0,0,0,0,0,0,0,0,0,0,0,
        65,28,11,8,0,0,0,0,0,0,0,0,0,65,36,11,8,0,0,128,63,0,0,0,0,0,65,44,11,8,0,0,128,63,0,0,0,0,0,65,52,11,8,0,0,128,63,0,0,0,0,0,65,60,11,8,0,0,128,63,0,0,0,0,0,65,196,0,11,140,2,131,249,162,0,68,78,110,0,252,41,21,0,209,87,39,0,221,52,245,0,98,219,192,0,60,153,149,0,65,144,67,0,99,81,254,0,187,222,171,0,183,97,197,0,58,110,36,0,210,77,66,0,73,6,224,0,9,234,46,0,28,146,209,0,235,29,254,0,41,177,28,0,232,62,167,0,245,53,130,0,68,187,46,0,156,233,132,0,180,38,112,0,65,126,95,0,214,145,57,0,83,131,57,0,156,244,57,0,139,95,132,0,40,249,189,0,248,31,59,0,222,255,151,0,15,152,5,0,17,47,
        239,0,10,90,139,0,109,31,109,0,207,126,54,0,9,203,39,0,70,79,183,0,158,102,63,0,45,234,95,0,186,39,117,0,229,235,199,0,61,123,241,0,247,57,7,0,146,82,138,0,251,107,234,0,31,177,95,0,8,93,141,0,48,3,86,0,123,252,70,0,240,171,107,0,32,188,207,0,54,244,154,0,227,169,29,0,94,97,145,0,8,27,230,0,133,153,101,0,160,20,95,0,141,64,104,0,128,216,255,0,39,115,77,0,6,6,49,0,202,86,21,0,201,168,115,0,123,226,96,0,107,140,192,0,0,0,0,0,0,65,208,2,11,140,2,131,249,162,0,68,78,110,0,252,41,21,0,209,87,39,0,221,52,245,0,98,219,192,0,60,153,149,0,65,144,67,0,99,81,254,0,187,222,171,0,183,97,197,0,58,110,36,0,210,77,66,0,73,6,224,0,
        9,234,46,0,28,146,209,0,235,29,254,0,41,177,28,0,232,62,167,0,245,53,130,0,68,187,46,0,156,233,132,0,180,38,112,0,65,126,95,0,214,145,57,0,83,131,57,0,156,244,57,0,139,95,132,0,40,249,189,0,248,31,59,0,222,255,151,0,15,152,5,0,17,47,239,0,10,90,139,0,109,31,109,0,207,126,54,0,9,203,39,0,70,79,183,0,158,102,63,0,45,234,95,0,186,39,117,0,229,235,199,0,61,123,241,0,247,57,7,0,146,82,138,0,251,107,234,0,31,177,95,0,8,93,141,0,48,3,86,0,123,252,70,0,240,171,107,0,32,188,207,0,54,244,154,0,227,169,29,0,94,97,145,0,8,27,230,0,133,153,101,0,160,20,95,0,141,64,104,0,128,216,255,0,39,115,77,0,6,6,49,0,202,86,21,0,201,168,115,0,123,
        226,96,0,107,140,192,0,0,0,0,0,0,65,220,4,11,8,2,0,0,0,0,0,0,0,0,65,228,4,11,8,0,0,0,0,0,0,0,0,0,65,236,4,11,8,1,0,0,0,0,0,0,0,0,65,244,4,11,8,0,0,0,0,0,0,0,0,0,65,252,4,11,8,0,0,0,0,0,0,0,0,0,65,132,5,11,8,0,0,0,0,0,0,0,0,0,65,140,5,11,8,0,0,0,0,0,0,0,0,0,65,148,5,11,8,0,0,128,63,0,0,0,0,0,65,156,5,11,8,2,0,0,0,0,0,0,0,0,65,164,5,11,8,0,0,0,0,0,0,0,0,0,65,172,5,11,8,0,0,0,0,0,0,0,0,0,65,180,5,11,8,0,0,0,0,0,0,0,0,0,65,188,5,11,8,0,0,0,0,0,0,0,0,0,65,196,5,11,8,0,0,
        128,63,0,0,0,0,0,65,204,5,11,8,0,0,0,0,0,0,0,0,0,65,212,5,11,8,0,0,72,66,0,0,0,0,0,65,220,5,11,8,32,0,0,0,0,0,0,0,0,65,228,5,11,8,0,0,0,0,0,0,0,0,0,65,236,5,11,8,1,0,0,0,0,0,0,0,0,65,244,5,11,8,0,0,0,0,0,0,0,0,0,65,252,5,11,68,0,0,0,64,251,33,249,63,0,0,0,0,45,68,116,62,0,0,0,128,152,70,248,60,0,0,0,96,81,204,120,59,0,0,0,128,131,27,240,57,0,0,0,64,32,37,122,56,0,0,0,128,34,130,227,54,0,0,0,0,29,243,105,53,0,0,0,0,0,65,192,6,11,212,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65,148,8,11,132,32,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,]);
  }
}



function getManifest()
{
    return {
  "CmajorVersion": 1,
  "ID": "dev.cmajor.adc23",
  "version": "1.0",
  "name": "Tremolo",
  "description": "Tremolo",
  "category": "effect",
  "manufacturer": "Sound Stacks Ltd",
  "isInstrument": false,
  "plugin": {
    "manufacturerCode": "Cmaj",
    "pluginCode": "adc8"
  },
  "source": "Tremolo.cmajor",
  "view": {
    "src": "ui/index.js",
    "width": 250,
    "height": 423,
    "resizable": false
  }
};
}

export default createAudioWorkletNodePatchConnection;