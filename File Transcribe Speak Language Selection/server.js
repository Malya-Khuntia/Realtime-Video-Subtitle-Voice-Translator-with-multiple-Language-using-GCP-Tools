const express = require('express');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate');
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');

if (!process.env.GOOGLE_CLOUD_PROJECT) {
  console.error('FATAL ERROR: GOOGLE_CLOUD_PROJECT environment variable not set.');
  process.exit(1);
} else {
  console.log(`[Server] Using GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);
}

const LANGUAGE_CONFIG = {
    'en-US': { name: 'English (US)', ttsVoice: 'en-US-Standard-C', ttsLangCode: 'en-US', translateCode: 'en' },
    'en-CA': { name: 'English (Canada)', ttsVoice: 'en-CA-Standard-A', ttsLangCode: 'en-CA', translateCode: 'en' },
    'en-GB': { name: 'English (UK)', ttsVoice: 'en-GB-Standard-A', ttsLangCode: 'en-GB', translateCode: 'en' },
    'hi-IN': { name: 'Hindi (India)', ttsVoice: 'hi-IN-Standard-A', ttsLangCode: 'hi-IN', translateCode: 'hi' },
    'fr-CA': { name: 'French (Canada)', ttsVoice: 'fr-CA-Standard-A', ttsLangCode: 'fr-CA', translateCode: 'fr' },
    'fr-FR': { name: 'French (France)', ttsVoice: 'fr-FR-Standard-A', ttsLangCode: 'fr-FR', translateCode: 'fr' },
    'es-ES': { name: 'Spanish (Spain)', ttsVoice: 'es-ES-Standard-A', ttsLangCode: 'es-ES', translateCode: 'es' },
    'es-MX': { name: 'Spanish (Mexico)', ttsVoice: 'es-MX-Standard-A', ttsLangCode: 'es-MX', translateCode: 'es' },
    'de-DE': { name: 'German (Germany)', ttsVoice: 'de-DE-Standard-F', ttsLangCode: 'de-DE', translateCode: 'de' },
    'ja-JP': { name: 'Japanese (Japan)', ttsVoice: 'ja-JP-Standard-A', ttsLangCode: 'ja-JP', translateCode: 'ja' },
    'ko-KR': { name: 'Korean (South Korea)', ttsVoice: 'ko-KR-Standard-A', ttsLangCode: 'ko-KR', translateCode: 'ko'},
    'cmn-CN': { name: 'Chinese (Mandarin, CN)', ttsVoice: 'cmn-CN-Standard-A', ttsLangCode: 'cmn-CN', translateCode: 'zh-CN' },
    'ar-XA': { name: 'Arabic (MSA)', ttsVoice: 'ar-XA-Standard-A', ttsLangCode: 'ar-XA', translateCode: 'ar' },
};
const TTS_SPEAKING_RATE = 1.0;

const app = express();
const server = app.listen(8080, () => {
  console.log('[Server] HTTP Live Streaming Server running on port 8080 (for Cloud Shell proxy)');
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
  console.log(`[${connectionTimestamp}] [Server] WebSocket client connected. Waiting for language config.`);
  let recognizeStream = null;
  let audioQueue = [];
  let clientConnectionConfig = null;
  let streamErrored = false; 

  const initializeGoogleStream = () => {
    if (streamErrored) { console.warn(`[${new Date().toISOString()}] [Server] Google Stream previously errored. Not re-initializing.`); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: 'Speech API stream error. Reconnect.' })); return; }
    if (!clientConnectionConfig) { console.error(`[${new Date().toISOString()}] [Server CRITICAL] Init Google Stream without client config.`); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: 'Server: Client config not received.' })); return; }
    const initTimestamp = new Date().toISOString(); console.log(`[${initTimestamp}] [Server] Initializing Google Speech: ${clientConnectionConfig.sourceLanguageCode}`);
    const requestConfig = { config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: clientConnectionConfig.sourceLanguageCode, enableAutomaticPunctuation: true, }, interimResults: true, };
    console.log(`[Server DEBUG] Google Speech API config: ${JSON.stringify(requestConfig.config)}`);
    recognizeStream = speechClient.streamingRecognize(requestConfig)
      .on('error', (error) => { const errT = new Date().toISOString(); console.error(`\n!!!\n[${errT}] [Server CRITICAL] Google Speech API Error:\nCode: ${error.code}, Details: ${error.details}\n${error}\n!!!\n`); streamErrored = true; if (recognizeStream) recognizeStream.destroy(); recognizeStream = null; try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: `Speech API error (code ${error.code}): ${error.details || error.message}.` })); } catch (e) { console.error(`[${errT}] [Server] Error sending API error to client:`, e); }})
      .on('data', async (data) => { if (!clientConnectionConfig) return; const dT = new Date().toISOString(); if (!data.results || data.results.length === 0) return; const trans = data.results[0]?.alternatives[0]?.transcript||''; const iF = data.results[0]?.isFinal||false; let trlt = 'Translating...'; let cD = {transcription:trans, isFinal:iF, translation:trlt, synthesizedAudio:null}; if (iF&&trans.trim()!=="") { console.log(`[${dT}] [Server] Final Trans (${clientConnectionConfig.sourceLangDetails.name}): "${trans}"`); try { const tR={contents:[trans],mimeType:'text/plain',sourceLanguageCode:clientConnectionConfig.sourceLangDetails.translateCode,targetLanguageCode:clientConnectionConfig.targetLangDetails.translateCode,parent:`projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`}; const [tResp]=await translateClient.translateText(tR); trlt=tResp.translations[0]?.translatedText||'[Translation Unavailable]'; cD.translation=trlt; if(trlt&&trlt!=='[Translation Unavailable]'&&trlt!=='[Translation Error]'&&trlt.trim()!==''){try{const ttsP={input:{text:trlt},voice:{languageCode:clientConnectionConfig.targetLangDetails.ttsLangCode,name:clientConnectionConfig.targetLangDetails.ttsVoice},audioConfig:{audioEncoding:'MP3',speakingRate:TTS_SPEAKING_RATE}};const[ttsR]=await ttsClient.synthesizeSpeech(ttsP);cD.synthesizedAudio=ttsR.audioContent.toString('base64')}catch(ttsE){cD.translation+=" [TTS Gen Error]";console.error("TTS Err:",ttsE)}}}catch(pE){cD.translation=(cD.translation==='Translating...'?"[Pipeline Error]":cD.translation+" [Error]");console.error("Pipeline Err:",pE)}}else if(iF&&trans.trim()===""){cD.translation=""} try{if(ws.readyState===WebSocket.OPEN){if(trans||iF){ws.send(JSON.stringify(cD))}}}catch(e){console.error("Send data err:",e)}})
      .on('end', () => { if(recognizeStream)recognizeStream.destroy();recognizeStream=null; });
    console.log(`[${initTimestamp}] [Server] Google Speech stream created. Flushing queue (${audioQueue.length}).`);
    while(audioQueue.length>0){const ch=audioQueue.shift();if(recognizeStream&&recognizeStream.writable){recognizeStream.write(ch)}else{audioQueue.unshift(ch);break;}}
  };

  ws.on('message', (messageData) => {
    const msgTimestamp = new Date().toISOString();
    let potentialStringConfig = null;

    console.log(`[Server RAW Message Handler] Timestamp: ${msgTimestamp}, Typeof messageData: ${typeof messageData}`);
    if (Buffer.isBuffer(messageData)) {
        console.log(`[Server RAW Message Handler] Received BUFFER data. Length: ${messageData.length}. Assuming UTF-8 string content for config.`);
        try {
            potentialStringConfig = messageData.toString('utf8');
            console.log(`[Server RAW Message Handler] Buffer converted to string (first 100 chars): ${potentialStringConfig.substring(0,100)}`);
        } catch (bufferErr) {
            console.error(`[Server CRITICAL] Error converting Buffer to string:`, bufferErr);
        }
    } else if (typeof messageData === 'string') {
        console.log(`[Server RAW Message Handler] Received direct STRING data (first 100 chars): ${messageData.substring(0, 100)}`);
        potentialStringConfig = messageData;
    } else {
        console.log(`[Server RAW Message Handler] Received data of UNKNOWN type.`);
    }

    if (potentialStringConfig) {
        try {
            const parsedMessage = JSON.parse(potentialStringConfig);
            if (parsedMessage && parsedMessage.type === 'config') {
                console.log(`[Server SUCCESS] ---->>>> Successfully Parsed 'config' message from client:`, parsedMessage);
                const { sourceLang, targetLang } = parsedMessage;
                streamErrored = false; 
                if (!LANGUAGE_CONFIG[sourceLang] || !LANGUAGE_CONFIG[targetLang]) {
                    const errorMsg = `Invalid lang codes: Src='${sourceLang}', Tgt='${targetLang}'`;
                    console.error(`[${msgTimestamp}] [Server CRITICAL] ${errorMsg}`);
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: errorMsg }));
                    ws.close(); return;
                }
                clientConnectionConfig = { sourceLanguageCode: sourceLang, targetLanguageCode: targetLang, sourceLangDetails: LANGUAGE_CONFIG[sourceLang], targetLangDetails: LANGUAGE_CONFIG[targetLang] };
                console.log(`[${msgTimestamp}] [Server] Configured for Source: ${clientConnectionConfig.sourceLangDetails.name}, Target: ${clientConnectionConfig.targetLangDetails.name}`);
                if (ws.readyState === WebSocket.OPEN) {
                    const ackMsg = { type: 'config_ack', source: clientConnectionConfig.sourceLangDetails.name, target: clientConnectionConfig.targetLangDetails.name };
                    try { const ackMsgString = JSON.stringify(ackMsg); ws.send(ackMsgString); console.log(`[Server SUCCESS] ---->>>> Sent 'config_ack' to client. Message: ${ackMsgString}`);
                    } catch (sendError) { console.error(`[Server CRITICAL] ---->>>> FAILED to send 'config_ack'. Error:`, sendError); }
                } else { console.warn("[Server WARN] ---->>>> WebSocket not OPEN when trying to send 'config_ack'. State: " + ws.readyState); }
                if (recognizeStream) { console.log(`[${msgTimestamp}] [Server DEBUG] Ending old recognizeStream on new config.`); recognizeStream.end(); recognizeStream.destroy(); recognizeStream = null; }
                console.log(`[${msgTimestamp}] [Server DEBUG] (Re)initializing Google stream after config.`);
                initializeGoogleStream();
                return; 
            } else {
                console.warn(`[${msgTimestamp}] [Server WARN] Parsed string from message, but not 'config' type. Type was: ${parsedMessage?.type}. Original string: ${potentialStringConfig.substring(0, 200)}`);
            }
        } catch (e) { 
            console.warn(`[${msgTimestamp}] [Server WARN] Error parsing potential string config as JSON. Error: ${e.message}. String was: ${potentialStringConfig ? potentialStringConfig.substring(0,200) : "null"}`);
        }
    }
    
    console.log(`[Server INFO] Message not handled as a 'config' JSON string. Current clientConnectionConfig: ${!!clientConnectionConfig}. Assuming audio data if configured, or pre-config data if not.`);

    if (!clientConnectionConfig) {
      console.warn(`[${msgTimestamp}] [Server FALLBACK] clientConnectionConfig is NOT set. Treating message as pre-config audio/unknown. Queuing. Queue size: ${audioQueue.length + 1}`);
      audioQueue.push(Buffer.isBuffer(messageData) ? messageData : Buffer.from(messageData)); return;
    }

    if (streamErrored) { console.warn(`[${msgTimestamp}] [Server FALLBACK] Stream errored, discarding subsequent non-config message (assumed audio).`); return; }
    const audioChunk = Buffer.isBuffer(messageData) ? messageData : (typeof messageData === 'string' ? Buffer.from(messageData) : null);
    if (!audioChunk || audioChunk.length < 100) { return; } 
    if (!recognizeStream || !recognizeStream.writable) {
      audioQueue.push(audioChunk);
      if (!recognizeStream && clientConnectionConfig && !streamErrored) { console.log(`[${msgTimestamp}] [Server FALLBACK] Google stream is null, re-init for audio.`); initializeGoogleStream(); }
      return;
    }
    try {
      recognizeStream.write(audioChunk, (err) => { if (err) { console.error(`[${msgTimestamp}] [Server CRITICAL] ASYNC Google stream write error:`, err); streamErrored = true; if (recognizeStream) recognizeStream.destroy(); recognizeStream = null; }});
    } catch (error) { console.error(`[${msgTimestamp}] [Server CRITICAL] SYNC Google stream write error:`, error); streamErrored = true; if (recognizeStream) recognizeStream.destroy(); recognizeStream = null; audioQueue.push(audioChunk); }
  });

  ws.on('close', (code, reason) => { const ts=new Date().toISOString(); console.log(`[${ts}] [Server] WS client disconnected. Code: ${code}, Reason: ${reason?reason.toString():'N/A'}`); if(recognizeStream){recognizeStream.end();recognizeStream.destroy()} recognizeStream=null;audioQueue=[];clientConnectionConfig=null;streamErrored=false; });
  ws.on('error', (err) => { const ts=new Date().toISOString(); console.error(`[${ts}] [Server CRITICAL] WS conn error:`, err); if(recognizeStream)recognizeStream.destroy(); recognizeStream=null;audioQueue=[];clientConnectionConfig=null;streamErrored=true; });
});
console.log(`[Server] Project ID: ${process.env.GOOGLE_CLOUD_PROJECT || 'Not Set (SDK will try default)'}`);
console.log('[Server] Available languages configured.');