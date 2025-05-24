const express = require('express');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate');
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');

// Check for GOOGLE_CLOUD_PROJECT environment variable
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  console.error('FATAL ERROR: GOOGLE_CLOUD_PROJECT environment variable not set.');
  console.error('API services will fail.');
  console.error('Please set this variable before running the server.');
  process.exit(1);
}

// ****** CONFIGURATION (GLOBAL SCOPE FOR THIS MODULE) ******
const SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION = 'en-US';
const TARGET_LANGUAGE_CODE_FOR_TRANSLATION = 'hi';
const TTS_VOICE_NAME = 'hi-IN-Wavenet-A'; // Example: 'hi-IN-Standard-A' for potentially lower latency
const TTS_SPEAKING_RATE = 1.0;
// **********************************************************

const app = express();
const server = app.listen(8080, () => {
  console.log('Server running on port 8080');
});
const wss = new WebSocket.Server({ server });

const speechClient = new speech.SpeechClient();
const translateClient = new translate.TranslationServiceClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  let recognizeStream = null;
  let audioQueue = [];

  const initializeGoogleStream = () => {
    const requestConfig = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION,
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    };

    console.log(`Initializing Google Speech stream for language: ${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}`);
    recognizeStream = speechClient
      .streamingRecognize(requestConfig)
      .on('error', (error) => {
        console.error('Google Speech API Error:', error);
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
        try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ error: `Speech API error: ${error.message}` }));
            }
        } catch (e) { console.error("Error sending API error to client:", e); }
      })
      .on('data', async (data) => {
        const transcription = data.results[0]?.alternatives[0]?.transcript || '';
        const isFinal = data.results[0]?.isFinal || false;

        let translation = 'Translating...';
        let clientData = {
            transcription,
            isFinal,
            translation,
            synthesizedAudio: null
        };

        if (isFinal && transcription) {
            console.log(`Final Transcription (${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}): "${transcription}"`);
            try {
                // 1. Translate Text
                console.time('translationApiCall'); // Start timer
                const [translateResponse] = await translateClient.translateText({
                    contents: [transcription],
                    mimeType: 'text/plain',
                    sourceLanguageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION.split('-')[0],
                    targetLanguageCode: TARGET_LANGUAGE_CODE_FOR_TRANSLATION,
                    parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`,
                });
                console.timeEnd('translationApiCall'); // End timer

                translation = translateResponse.translations[0]?.translatedText || '[Translation Unavailable]';
                console.log(`Translation (to ${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}): "${translation}"`);
                clientData.translation = translation;

                // 2. Synthesize Translated Text to Speech
                if (translation && translation !== '[Translation Unavailable]' && translation !== '[Translation Error]') {
                    try {
                        console.log(`Requesting TTS for: "${translation}"`);
                        const ttsRequestPayload = {
                            input: { text: translation },
                            voice: {
                                languageCode: TARGET_LANGUAGE_CODE_FOR_TRANSLATION + '-IN',
                                name: TTS_VOICE_NAME,
                            },
                            audioConfig: {
                                audioEncoding: 'MP3',
                                speakingRate: TTS_SPEAKING_RATE
                            },
                        };
                        console.time('ttsApiCall'); // Start timer
                        const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequestPayload);
                        console.timeEnd('ttsApiCall'); // End timer

                        clientData.synthesizedAudio = ttsResponse.audioContent.toString('base64');
                        console.log(`Synthesized audio for "${translation}" (sent ${clientData.synthesizedAudio.length} base64 chars)`);
                    } catch (ttsErr) {
                        console.error('Google Text-to-Speech API error:', ttsErr);
                        clientData.translation += " [TTS Gen Error]";
                    }
                }
            } catch (pipelineErr) {
                console.error('Translation or TTS pipeline error:', pipelineErr);
                clientData.translation = (clientData.translation === 'Translating...' ? "[Pipeline Error]" : clientData.translation + " [Error]");
            }
        }

        try {
            if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify(clientData));
            }
        } catch (e) { console.error("Error sending data to client:", e); }
      })
      .on('end', () => {
        console.log('Google Speech Recognize stream ended by API.');
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
      });

    console.log('Google Speech stream initialized. Flushing queue.');
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift();
      if (recognizeStream && recognizeStream.writable) {
        recognizeStream.write(chunk);
      } else {
        console.warn('Google stream non-writable while flushing. Re-queuing.');
        audioQueue.unshift(chunk);
        break;
      }
    }
  };

  initializeGoogleStream();

  ws.on('message', (data) => {
    const audioChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (audioChunk.length < 10) return;

    if (!recognizeStream || !recognizeStream.writable) {
      console.log('Google stream not ready/writable — queuing chunk');
      audioQueue.push(audioChunk);
      if (!recognizeStream) {
        console.log('Google stream null, re-initializing.');
        initializeGoogleStream();
      }
      return;
    }
    try {
      recognizeStream.write(audioChunk);
    } catch (error) {
      console.error('Sync Google stream write error:', error);
      if (recognizeStream) recognizeStream.destroy();
      recognizeStream = null;
      audioQueue.push(audioChunk);
      initializeGoogleStream();
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (recognizeStream) {
      console.log('Ending Google Speech stream (WS close).');
      recognizeStream.end();
      recognizeStream.destroy();
    }
    recognizeStream = null;
    audioQueue = [];
  });

  ws.on('error', (err) => {
    console.error('WebSocket server connection error:', err);
    if (recognizeStream) recognizeStream.destroy();
    recognizeStream = null;
    audioQueue = [];
  });
});

console.log(`Server configured for Transcription: '${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}', Translation: '${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}', TTS Voice: '${TTS_VOICE_NAME}'.`);
console.log(`Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'Not Set (SDK will try default)'}`);