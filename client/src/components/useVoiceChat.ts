/**
 * Browser voice helpers for Model Chat (phase 1).
 * - STT: Web SpeechRecognition / webkitSpeechRecognition
 * - TTS: speechSynthesis
 * No server keys; feature-detect and degrade gracefully.
 */

export type VoiceSupport = {
  recognition: boolean;
  synthesis: boolean;
};

export function detectVoiceSupport(): VoiceSupport {
  if (typeof window === "undefined") {
    return { recognition: false, synthesis: false };
  }
  const SpeechRec =
    (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  return {
    recognition: Boolean(SpeechRec),
    synthesis: typeof window.speechSynthesis !== "undefined",
  };
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor();
}

export type ListenOptions = {
  lang?: string;
  continuous?: boolean;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

/** One-shot or continuous listen. Caller must stop() when done if continuous. */
export function startListening(options: ListenOptions = {}): { stop: () => void } | null {
  const recognition = createRecognition();
  if (!recognition) return null;

  recognition.lang = options.lang || "en-ZA";
  recognition.continuous = Boolean(options.continuous);
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => options.onStart?.();
  recognition.onend = () => options.onEnd?.();
  recognition.onerror = (event) => {
    const map: Record<string, string> = {
      "not-allowed": "Microphone permission denied.",
      "no-speech": "No speech detected.",
      "audio-capture": "No microphone available.",
      network: "Speech recognition network error.",
      aborted: "Listening stopped.",
    };
    options.onError?.(map[event.error] || `Speech error: ${event.error}`);
  };
  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim) options.onInterim?.(interim);
    if (finalText) options.onFinal?.(finalText.trim());
  };

  try {
    recognition.start();
  } catch {
    options.onError?.("Could not start microphone.");
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export type SpeakOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/** Strip light markdown so TTS does not read stars and hashes. */
export function plainTextForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function speakText(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    options.onError?.("Speech synthesis not available in this browser.");
    return false;
  }
  const cleaned = plainTextForSpeech(text);
  if (!cleaned) return false;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = options.lang || "en-ZA";
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.("Could not speak this message.");
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
