import os
import uuid
import subprocess
import shutil
from flask import Flask, request, jsonify, render_template, url_for
from concurrent.futures import ThreadPoolExecutor
import logging

# Configure basic logging to see startup messages in Cloud Run logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

logging.info("Starting application: importing libraries.")

# Import Google Cloud libraries
from google.cloud import speech
from google.cloud import speech_v2
from google.cloud import translate_v2 as translate
from google.cloud import texttospeech as tts
from google.cloud import storage
from pydub import AudioSegment

logging.info("Library imports successful.")

# --- Configuration for US-CENTRAL1 ---
GCS_BUCKET_NAME = "BUCKET_NAME" # Make sure this GCS bucket exists and change your bucket name
GCP_PROJECT_ID = "PROJECT_ID"  # Make sure change your Project ID
RECOGNIZER_LOCATION = "us-central1"
SPEECH_API_ENDPOINT = "us-central1-speech.googleapis.com"
CLEANUP_TEMP_FILES = True
STT_STRATEGY = 'V1_ONLY'

# --- Other constants ---
SYNC_GROUP_MAX_WORDS = 12; SYNC_GROUP_MAX_DURATION_S = 7.0; SYNC_GROUP_SIGNIFICANT_PAUSE_S = 0.6
VOICE_CATALOG = { "Default": None, "Aoede (F)": "en-US-Wavenet-F", "Puck (M)": "en-US-Wavenet-D", "Kore (F)": "en-US-Wavenet-H", "Charon (M)": "en-GB-Wavenet-B", "Leda (F)": "en-GB-Wavenet-A", "Fenrir (M)": "de-DE-Wavenet-B", "Orus (M)": "hi-IN-Wavenet-B", "Zephyr (F)": "hi-IN-Wavenet-A", "French Leda (F)": "fr-FR-Wavenet-A", "Spanish Male": "es-ES-Wavenet-B", "Spanish Female": "es-ES-Wavenet-C", "Japanese Female": "ja-JP-Wavenet-A", "Russian Male": "ru-RU-Wavenet-B" }
GLOBAL_TTS_SPEAKING_RATE = 1.0; TARGET_AUDIO_BITRATE = "96k"; PYDUB_CONCAT_CROSSFADE_MS = 10
TEMP_SEGMENT_PROCESSING_DIR = os.path.join('static', 'temp_segments')

# --- Flask App Initialization ---
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'}
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024

logging.info("Flask app initialized.")

# --- API Client Initialization ---
clients_initialized = False
try:
    logging.info("Initializing Google Cloud API clients for us-central1.")
    client_options = {"api_endpoint": SPEECH_API_ENDPOINT}
    speech_client_v2 = speech_v2.SpeechClient(client_options=client_options)
    speech_client_v1 = speech.SpeechClient()
    translate_client = translate.Client()
    tts_client = tts.TextToSpeechClient()
    storage_client = storage.Client()
    clients_initialized = True
    logging.info("Google Cloud clients initialized successfully.")
except Exception as e:
    logging.critical(f"FATAL: Could not initialize Google Cloud clients. Error: {e}", exc_info=True)


# --- Helper Functions ---
def allowed_file(filename): return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
def get_base_language_code(full_code): return full_code.split('-')[0] if '-' in full_code else full_code
def upload_to_gcs(bucket_name, source_file_name, destination_blob_name):
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_filename(source_file_name)
    logging.info(f"File {source_file_name} uploaded to gs://{bucket_name}/{destination_blob_name}.")
    return f"gs://{bucket_name}/{destination_blob_name}"
def delete_from_gcs(bucket_name, blob_name):
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    if blob.exists():
        blob.delete()
        logging.info(f"Deleted gs://{bucket_name}/{blob_name} from GCS.")

@app.route('/')
def index():
    return render_template('index.html')

# (The rest of the file is the same as the previous correct version)
@app.route('/translate-video', methods=['POST'])
def translate_video_route():
    if not clients_initialized:
        logging.error("Request received but clients are not initialized.")
        return jsonify({"error": "Server-side API clients are not initialized. Check server logs."}), 500

    if 'videoFile' not in request.files: return jsonify({"error": "No video file part"}), 400
    file = request.files['videoFile']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    if not allowed_file(file.filename): return jsonify({"error": "Invalid file type"}), 400

    from_lang = request.form.get('fromLang', 'en-US'); to_lang = request.form.get('toLang', 'hi-IN')
    voice_selection_friendly = request.form.get('voice', 'Default')

    unique_id = str(uuid.uuid4()); request_temp_dir = os.path.join(TEMP_SEGMENT_PROCESSING_DIR, unique_id)
    os.makedirs(request_temp_dir, exist_ok=True); os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    original_video_filename = f"{unique_id}_{file.filename.replace(' ', '_')}"
    original_video_path = os.path.join(app.config['UPLOAD_FOLDER'], original_video_filename); file.save(original_video_path)

    extracted_audio_path = os.path.join(request_temp_dir, f"{unique_id}_extracted_audio.wav")
    final_video_filename = f"{unique_id}_translated.mp4"; final_audio_filename = f"{unique_id}_final_voiceover.mp3"
    final_video_path = os.path.join(app.config['UPLOAD_FOLDER'], final_video_filename)
    final_adjusted_translated_audio_path = os.path.join(app.config['UPLOAD_FOLDER'], final_audio_filename)

    gcs_audio_uri, gcs_audio_blob_name = None, None
    transcript_text_full, translated_text_full = "", ""; all_original_words = []

    try:
        logging.info(f"[{unique_id}] Extracting audio from {original_video_path}")
        ffmpeg_command = ['ffmpeg', '-i', original_video_path, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-af', 'loudnorm', '-y', extracted_audio_path]
        subprocess.run(ffmpeg_command, check=True, capture_output=True, text=True)

        gcs_audio_blob_name = f"audio-uploads/{unique_id}/extracted_audio.wav"
        gcs_audio_uri = upload_to_gcs(GCS_BUCKET_NAME, extracted_audio_path, gcs_audio_blob_name)

        if STT_STRATEGY in ['BEST_EFFORT', 'CHIRP_ONLY']:
            try:
                dynamic_recognizer_id = f"chirp-{from_lang.lower()}"
                logging.info(f"[{unique_id}] Attempting STT with Chirp model: {dynamic_recognizer_id}")
                recognizer_name = f"projects/{GCP_PROJECT_ID}/locations/{RECOGNIZER_LOCATION}/recognizers/{dynamic_recognizer_id}"
                
                config_stt_v2 = speech_v2.RecognitionConfig(
                    auto_decoding_config={},
                    language_codes=[from_lang],
                    model="chirp",
                    features=speech_v2.RecognitionFeatures(
                        enable_automatic_punctuation=True,
                        enable_word_time_offsets=True
                    )
                )
                request_stt_v2 = speech_v2.BatchRecognizeRequest(
                    recognizer=recognizer_name,
                    config=config_stt_v2,
                    files=[speech_v2.BatchRecognizeFileMetadata(uri=gcs_audio_uri)],
                    recognition_output_config=speech_v2.RecognitionOutputConfig(inline_response_config={})
                )

                operation_v2 = speech_client_v2.batch_recognize(request=request_stt_v2); stt_response_v2 = operation_v2.result(timeout=1200)
                if gcs_audio_uri in stt_response_v2.results and not stt_response_v2.results[gcs_audio_uri].error:
                    for alternative in stt_response_v2.results[gcs_audio_uri].alternatives:
                        all_original_words.extend(alternative.words)
            except Exception as e:
                logging.warning(f"[{unique_id}] Chirp STT failed: {e}")

        if STT_STRATEGY in ['BEST_EFFORT', 'V1_ONLY'] and not all_original_words:
            logging.info(f"[{unique_id}] Using classic STT v1 model...")
            try:
                audio_v1 = speech.RecognitionAudio(uri=gcs_audio_uri)
                config_v1 = speech.RecognitionConfig(encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16, sample_rate_hertz=16000, language_code=from_lang, enable_automatic_punctuation=True, enable_word_time_offsets=True)
                operation_v1 = speech_client_v1.long_running_recognize(config=config_v1, audio=audio_v1); stt_response_v1 = operation_v1.result(timeout=1200)
                for result in stt_response_v1.results:
                    all_original_words.extend(result.alternatives[0].words)
            except Exception as e:
                logging.warning(f"[{unique_id}] STT v1 failed: {e}")

        if all_original_words:
            logging.info(f"[{unique_id}] Detected {len(all_original_words)} words. Proceeding with translation and TTS.")
            is_v1_format = hasattr(all_original_words[0], 'start_time')

            original_sync_groups, current_group_words_text = [], []
            current_group_start_time_s = all_original_words[0].start_time.total_seconds() if is_v1_format else all_original_words[0].start_offset.total_seconds()
            for i, word_info in enumerate(all_original_words):
                word_text = word_info.word; word_start_s = word_info.start_time.total_seconds() if is_v1_format else word_info.start_offset.total_seconds(); word_end_s = word_info.end_time.total_seconds() if is_v1_format else word_info.end_offset.total_seconds()
                if not current_group_words_text: current_group_start_time_s = word_start_s
                current_group_words_text.append(word_text); is_eos_punctuation = word_text.endswith(('.', '?', '!')); max_words_reached = len(current_group_words_text) >= SYNC_GROUP_MAX_WORDS
                current_group_duration_s = word_end_s - current_group_start_time_s; max_duration_reached = current_group_duration_s >= SYNC_GROUP_MAX_DURATION_S
                next_word_start_s = 0
                if i + 1 < len(all_original_words): next_word_start_s = all_original_words[i+1].start_time.total_seconds() if is_v1_format else all_original_words[i+1].start_offset.total_seconds()
                significant_pause_after = (i + 1 < len(all_original_words)) and (next_word_start_s - word_end_s) >= SYNC_GROUP_SIGNIFICANT_PAUSE_S; is_last_word = (i == len(all_original_words) - 1)
                if is_eos_punctuation or max_words_reached or max_duration_reached or significant_pause_after or is_last_word:
                    group_text = " ".join(current_group_words_text); original_sync_groups.append({"id": len(original_sync_groups), "original_text": group_text, "original_start_time_s": current_group_start_time_s, "original_end_time_s": word_end_s})
                    transcript_text_full += group_text + " "; current_group_words_text = []

            source_lang_translate, target_lang_translate = get_base_language_code(from_lang), get_base_language_code(to_lang)
            if source_lang_translate != target_lang_translate:
                logging.info(f"[{unique_id}] Running batch translation from {source_lang_translate} to {target_lang_translate}...")
                texts_to_translate = [g['original_text'] for g in original_sync_groups]
                translate_results = translate_client.translate(texts_to_translate, target_language=target_lang_translate, source_language=source_lang_translate)
                for i, group in enumerate(original_sync_groups): group['translated_text'] = translate_results[i]['translatedText']; translated_text_full += group['translated_text'] + " "
            else:
                logging.info(f"[{unique_id}] Source and target languages are the same. Skipping translation.")
                for group in original_sync_groups: group['translated_text'] = group['original_text']; translated_text_full += group['original_text'] + " "

            logging.info(f"[{unique_id}] Running concurrent TTS for all text groups...")
            def run_tts_for_group(group):
                natural_tts_path = os.path.join(request_temp_dir, f"group_{group['id']}_natural_tts.mp3"); google_voice_name = VOICE_CATALOG.get(voice_selection_friendly)
                selected_voice_name_for_api = google_voice_name if google_voice_name and google_voice_name.lower().startswith(get_base_language_code(to_lang).lower()) else None
                voice_params = tts.VoiceSelectionParams(language_code=to_lang, name=selected_voice_name_for_api)
                audio_config_tts = tts.AudioConfig(audio_encoding=tts.AudioEncoding.MP3, speaking_rate=GLOBAL_TTS_SPEAKING_RATE)
                response_tts = tts_client.synthesize_speech(input=tts.SynthesisInput(text=group['translated_text']), voice=voice_params, audio_config=audio_config_tts)
                with open(natural_tts_path, 'wb') as out_f: out_f.write(response_tts.audio_content)
                group['natural_tts_audio_path'] = natural_tts_path
                return group
            with ThreadPoolExecutor(max_workers=10) as executor: original_sync_groups = list(executor.map(run_tts_for_group, original_sync_groups))

            final_natural_audio = AudioSegment.empty(); last_orig_segment_end_time_ms = 0
            first_word_start_s = all_original_words[0].start_time.total_seconds() if is_v1_format else all_original_words[0].start_offset.total_seconds()
            overall_audio_start_time_ms = int(first_word_start_s * 1000)
            if overall_audio_start_time_ms > 0: final_natural_audio += AudioSegment.silent(duration=overall_audio_start_time_ms); last_orig_segment_end_time_ms = overall_audio_start_time_ms
            for group in original_sync_groups:
                current_orig_segment_start_time_ms = int(group["original_start_time_s"] * 1000)
                silence_needed_ms = current_orig_segment_start_time_ms - last_orig_segment_end_time_ms
                if silence_needed_ms > 0: final_natural_audio += AudioSegment.silent(duration=silence_needed_ms)
                segment_audio = AudioSegment.from_mp3(group["natural_tts_audio_path"]); final_natural_audio = final_natural_audio.append(segment_audio, crossfade=PYDUB_CONCAT_CROSSFADE_MS if last_orig_segment_end_time_ms > 0 else 0)
                last_orig_segment_end_time_ms = int(group["original_end_time_s"] * 1000)
            final_natural_audio.export(final_adjusted_translated_audio_path, format="mp3", bitrate=TARGET_AUDIO_BITRATE)

        else:
            logging.warning(f"[{unique_id}] All STT models failed. Creating silent video.")
            transcript_text_full, translated_text_full = "(No speech detected)", "(No text to translate)"
            try:
                result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', original_video_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, text=True)
                duration_ms = int(float(result.stdout.strip()) * 1000)
            except Exception: duration_ms = 1000
            AudioSegment.silent(duration=duration_ms).export(final_adjusted_translated_audio_path, format="mp3", bitrate=TARGET_AUDIO_BITRATE)

        logging.info(f"[{unique_id}] Combining final audio and video.")
        ffmpeg_cmd = ['ffmpeg', '-i', original_video_path, '-i', final_adjusted_translated_audio_path, '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-y', final_video_path]
        subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True)
        final_video_url = url_for('static', filename=f'uploads/{final_video_filename}', _external=True)
        logging.info(f"[{unique_id}] Processing complete. URL: {final_video_url}")
        return jsonify({"transcript": transcript_text_full.strip(), "translation": translated_text_full.strip(), "translated_video_url": final_video_url})

    except Exception as e:
        import traceback
        error_msg = f"An unexpected error occurred for request {unique_id}."
        logging.error(f"{error_msg} Error: {e}", exc_info=True)
        return jsonify({"error": f"{error_msg} Check server logs for details."}), 500
    finally:
        if CLEANUP_TEMP_FILES:
            if gcs_audio_uri:
                try: delete_from_gcs(GCS_BUCKET_NAME, gcs_audio_blob_name)
                except Exception as e_gcs: logging.error(f"[{unique_id}] Error cleaning GCS: {e_gcs}")
            if os.path.exists(request_temp_dir):
                try: shutil.rmtree(request_temp_dir)
                except Exception as e_clean_dir: logging.error(f"[{unique_id}] Error cleaning temp dir: {e_clean_dir}")
            if os.path.exists(original_video_path):
                try: os.remove(original_video_path)
                except Exception as e: logging.error(f"[{unique_id}] Error removing original video: {e}")

# This block is for LOCAL DEVELOPMENT ONLY on port 5001.
# It is NOT used by Cloud Run.
if __name__ == '__main__':
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(TEMP_SEGMENT_PROCESSING_DIR, exist_ok=True)
    app.run(host='127.0.0.1', port=5001, debug=True)