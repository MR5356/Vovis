/** A recording bus whose clock survives replacement of the speaker output. */
export interface SpeechRecordingOutput {
  connectSource(source: AudioNode): void;
}

export function createSpeechRecording() {
  const clock = new AudioContext();
  const output = clock.createMediaStreamDestination();
  const bridges = new Map<
    BaseAudioContext,
    {
      input: MediaStreamAudioDestinationNode;
      source: MediaStreamAudioSourceNode;
    }
  >();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(output.stream);
  } catch (error) {
    output.stream.getTracks().forEach((track) => track.stop());
    void clock.close().catch(() => {});
    throw error;
  }
  const chunks: Blob[] = [];
  let failed = false;
  let stopped = false;
  recorder.ondataavailable = ({ data }) => {
    if (data.size) chunks.push(data);
  };
  const result = new Promise<Blob | undefined>((resolve) => {
    recorder.onerror = () => {
      failed = true;
      resolve(undefined);
    };
    recorder.onstop = () =>
      resolve(
        !failed && chunks.length
          ? new Blob(chunks, { type: recorder.mimeType })
          : undefined,
      );
  });
  const resume = () => {
    if (!stopped && clock.state !== "running")
      void clock.resume().catch(() => {
        failed = true;
      });
  };
  clock.addEventListener("statechange", resume);
  resume();
  try {
    recorder.start(1000);
  } catch (error) {
    stopped = true;
    clock.removeEventListener("statechange", resume);
    output.stream.getTracks().forEach((track) => track.stop());
    void clock.close().catch(() => {});
    throw error;
  }
  let stopping: Promise<Blob | undefined> | undefined;
  return {
    output: {
      connectSource(source: AudioNode) {
        if (stopped || failed) return;
        try {
          let bridge = bridges.get(source.context);
          if (!bridge) {
            const input = (
              source.context as AudioContext
            ).createMediaStreamDestination();
            const captured = clock.createMediaStreamSource(input.stream);
            captured.connect(output);
            bridge = { input, source: captured };
            bridges.set(source.context, bridge);
          }
          source.connect(bridge.input);
          resume();
        } catch {
          // A recording failure must not mute the live presentation.
          failed = true;
        }
      },
    } satisfies SpeechRecordingOutput,
    stop() {
      stopping ??= (async () => {
        stopped = true;
        clock.removeEventListener("statechange", resume);
        if (recorder.state !== "inactive") recorder.stop();
        const blob = await result;
        for (const bridge of bridges.values()) {
          bridge.source.disconnect();
          bridge.input.stream.getTracks().forEach((track) => track.stop());
        }
        bridges.clear();
        output.stream.getTracks().forEach((track) => track.stop());
        await clock.close().catch(() => {});
        return blob;
      })();
      return stopping;
    },
  };
}
