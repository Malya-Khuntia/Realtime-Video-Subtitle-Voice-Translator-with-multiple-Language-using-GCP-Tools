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
const TTS_VOICE_NAME = 'hi-IN-Standard-A';
const TTS_SPEAKING_RATE = 1.0;
// **********************************************************

const app = express();
const server = app.listen(8080, () => {
  console.log('[Server] Live Streaming Server running on port 8080');
});
const wss = new WebSocket.Server({ server });

const speechClient = new speech.SpeechClient();
const translateClient = new translate.TranslationServiceClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  console.log(`[Server] Serving index.html from ${filePath}`);
  res.sendFile(filePath);
});

wss.on('connection', (ws) => {
  const connectionTimestamp = new Date().toISOString();
  console.log(`[${connectionTimestamp}] [Server] WebSocket client connected for live streaming.`);
  let recognizeStream = null;
  let audioQueue = [];

  const initializeGoogleStream = () => {
    const initTimestamp = new Date().toISOString();
    console.log(`[${initTimestamp}] [Server] Initializing Google Speech stream for language: ${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}`);
    const requestConfig = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION,
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    };

    recognizeStream = speechClient
      .streamingRecognize(requestConfig)
      .on('error', (error) => {
        const errTimestamp = new Date().toISOString();
        console.error(`[${errTimestamp}] [Server] Google Speech API Error:`, error);
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
        try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ error: `Speech API error: ${error.message}` }));
            }
        } catch (e) { console.error(`[${errTimestamp}] [Server] Error sending API error to client:`, e); }
      })
      .on('data', async (data) => {
        const dataTimestamp = new Date().toISOString();
        // console.log(`[${dataTimestamp}] [Server] Received data from Speech API:`, JSON.stringify(data).substring(0,100) + "..."); // Can be very verbose

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
            console.log(`[${dataTimestamp}] [Server] Final Transcription (${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}): "${transcription}"`);
            try {
                console.time(`translationApiCall-${dataTimestamp}`);
                const [translateResponse] = await translateClient.translateText({
                    contents: [transcription],
                    mimeType: 'text/plain',
                    sourceLanguageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION.split('-')[0],
                    targetLanguageCode: TARGET_LANGUAGE_CODE_FOR_TRANSLATION,
                    parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`,
                });
                console.timeEnd(`translationApiCall-${dataTimestamp}`);

                translation = translateResponse.translations[0]?.translatedText || '[Translation Unavailable]';
                console.log(`[${dataTimestamp}] [Server] Translation (to ${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}): "${translation}"`);
                clientData.translation = translation;

                if (translation && translation !== '[Translation Unavailable]' && translation !== '[Translation Error]') {
                    try {
                        console.log(`[${dataTimestamp}] [Server] Requesting TTS for: "${translation}"`);
                        const ttsRequestPayload = {
                            input: { text: translation },
                            voice: {
                                languageCode: TARGET_LANGUAGE_CODE_FOR_TRANSLATION + '-IN',
                                name: TTS_VOICE_NAME,
                            },
                            audioConfig: { audioEncoding: 'MP3', speakingRate: TTS_SPEAKING_RATE },
                        };
                        console.time(`ttsApiCall-${dataTimestamp}`);
                        const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequestPayload);
                        console.timeEnd(`ttsApiCall-${dataTimestamp}`);

                        clientData.synthesizedAudio = ttsResponse.audioContent.toString('base64');
                        // console.log(`[${dataTimestamp}] [Server] Synthesized audio for "${translation}" (sent ${clientData.synthesizedAudio.length} base64 chars)`);
                    } catch (ttsErr) {
                        console.error(`[${dataTimestamp}] [Server] Google Text-to-Speech API error:`, ttsErr);
                        clientData.translation += " [TTS Gen Error]";
                    }
                }
            } catch (pipelineErr) {
                console.error(`[${dataTimestamp}] [Server] Translation or TTS pipeline error:`, pipelineErr);
                clientData.translation = (clientData.translation === 'Translating...' ? "[Pipeline Error]" : clientData.translation + " [Error]");
            }
        }

        try {
            if (ws.readyState === WebSocket.OPEN) {
                 // console.log(`[${new Date().toISOString()}] [Server] Sending data to client:`, JSON.stringify(clientData).substring(0,100) + "..."); // Can be verbose
                 ws.send(JSON.stringify(clientData));
            }
        } catch (e) { console.error(`[${new Date().toISOString()}] [Server] Error sending data to client:`, e); }
      })
      .on('end', () => {
        const endTimestamp = new Date().toISOString();
        console.log(`[${endTimestamp}] [Server] Google Speech Recognize stream ended by API.`);
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
      });

    console.log(`[${initTimestamp}] [Server] Google Speech stream object created. Flushing queue if any.`);
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift();
      if (recognizeStream && recognizeStream.writable) {
        // console.log(`[${new Date().toISOString()}] [Server] Writing queued chunk to Google stream. Size: ${chunk.length}`);
        recognizeStream.write(chunk);
      } else {
        console.warn(`[${new Date().toISOString()}] [Server] Google stream not writable while flushing. Re-queuing chunk.`);
        audioQueue.unshift(chunk);
        break;
      }
    }
  };

  initializeGoogleStream();

  ws.on('message', (data) => {
    const msgTimestamp = new Date().toISOString();
    console.log(`[${msgTimestamp}] [Server] Received WebSocket message from client. Type: ${typeof data}, Size: ${data.length || data.size || 'N/A'}`);

    const audioChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (audioChunk.length < 10) {
        console.log(`[${msgTimestamp}] [Server] Audio chunk too small (<10 bytes), skipping.`);
        return;
    }

    if (!recognizeStream || !recognizeStream.writable) {
      console.log(`[${msgTimestamp}] [Server] Google stream not ready/writable — queuing chunk. Queue size: ${audioQueue.length + 1}`);
      audioQueue.push(audioChunk);
      if (!recognizeStream) {
        console.log(`[${msgTimestamp}] [Server] Google stream is null, attempting to re-initialize.`);
        initializeGoogleStream(); // Attempt to re-establish
      }
      return;
    }
    try {
      // console.log(`[${msgTimestamp}] [Server] Writing audio chunk to Google stream. Size: ${audioChunk.length}`);
      recognizeStream.write(audioChunk);
    } catch (error) {
      console.error(`[${msgTimestamp}] [Server] Sync Google stream write error:`, error);
      if (recognizeStream) recognizeStream.destroy();
      recognizeStream = null;
      audioQueue.push(audioChunk); // Queue the chunk that failed
      initializeGoogleStream(); // Re-establish
    }
  });

  ws.on('close', () => {
    const closeTimestamp = new Date().toISOString();
    console.log(`[${closeTimestamp}] [Server] WebSocket client disconnected.`);
    if (recognizeStream) {
      console.log(`[${closeTimestamp}] [Server] Ending Google Speech stream due to WebSocket close.`);
      recognizeStream.end(); // Gracefully end the stream to Google
      recognizeStream.destroy(); // Ensure resources are freed
    }
    recognizeStream = null;
    audioQueue = []; // Clear queue for this connection
  });

  ws.on('error', (err) => {
    const errTimestamp = new Date().toISOString();
    console.error(`[${errTimestamp}] [Server] WebSocket server connection error:`, err);
    if (recognizeStream) recognizeStream.destroy();
    recognizeStream = null;
    audioQueue = [];
  });
});

console.log(`[Server] Live Server configured for Transcription: '${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}', Translation: '${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}', TTS Voice: '${TTS_VOICE_NAME}'.`);
console.log(`[Server] Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'Not Set (SDK will try default)'}`);