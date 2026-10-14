package expo.modules.sacvosk

import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.StorageService
import java.io.IOException

/**
 * Offline Vosk decoder that accepts PCM from SAC-Compass over BLE.
 * Does not open the phone microphone — audio arrives via [pushAudio].
 *
 * JS upsamples BLE 8 kHz int16 LE → 16 kHz for vosk-model-small-en-us.
 * loadModel sampleRate must be 16000 to match the model.
 */
class SacVoskModule : Module() {
  private var model: Model? = null
  private var recognizer: Recognizer? = null
  private var sampleRate = 16000.0f
  private var loaded = false

  private val reactContext
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SacVosk")

    Constant("DEFAULT_SAMPLE_RATE") { 16000 }
    Constant("DEFAULT_MODEL_ASSET") { DEFAULT_MODEL_ASSET }

    Function("isLoaded") { loaded && recognizer != null }

    AsyncFunction("loadModel") { assetName: String?, rate: Double?, promise: Promise ->
      val asset = assetName?.takeIf { it.isNotBlank() } ?: DEFAULT_MODEL_ASSET
      sampleRate = (rate ?: 16000.0).toFloat()

      unloadInternal()

      StorageService.unpack(
        reactContext,
        asset,
        "vosk-models",
        { unpacked: Model ->
          try {
            model = unpacked
            val rec = Recognizer(unpacked, sampleRate)
            // Word-level partials help the live transcript update sooner.
            try {
              rec.setWords(true)
            } catch (_: Throwable) {
              /* older vosk builds */
            }
            recognizer = rec
            loaded = true
            promise.resolve(true)
          } catch (e: IOException) {
            unloadInternal()
            promise.reject("VOSK_RECOGNIZER", e.message, e)
          }
        },
        { error: IOException ->
          unloadInternal()
          promise.reject(
            "VOSK_MODEL",
            "Failed to unpack Vosk model '$asset'. Run npm run vosk:model then rebuild. (${error.message})",
            error,
          )
        },
      )
    }

    /**
     * Feeds one base64 PCM window. Returns a map when there is text to surface:
     * `{ text, isFinal, confidence }`. Empty map / null fields when still buffering.
     */
    Function("pushAudio") { base64Pcm: String ->
      val rec = recognizer
      if (rec == null || base64Pcm.isEmpty()) {
        return@Function mapOf(
          "text" to "",
          "isFinal" to false,
          "confidence" to 0.0,
        )
      }

      val bytes =
        try {
          Base64.decode(base64Pcm, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
          Log.w(TAG, "Invalid base64 PCM chunk", e)
          return@Function mapOf(
            "text" to "",
            "isFinal" to false,
            "confidence" to 0.0,
          )
        }

      if (bytes.isEmpty()) {
        return@Function mapOf(
          "text" to "",
          "isFinal" to false,
          "confidence" to 0.0,
        )
      }

      val uttered = rec.acceptWaveForm(bytes, bytes.size)
      if (uttered) {
        val text = parseHypothesis(rec.result, "text") ?: ""
        mapOf(
          "text" to text,
          "isFinal" to true,
          "confidence" to 0.85,
        )
      } else {
        val text = parseHypothesis(rec.partialResult, "partial") ?: ""
        mapOf(
          "text" to text,
          "isFinal" to false,
          "confidence" to 0.5,
        )
      }
    }

    /** Flush any buffered speech (e.g. session end). */
    Function("flush") {
      val rec = recognizer
        ?: return@Function mapOf(
          "text" to "",
          "isFinal" to true,
          "confidence" to 0.0,
        )
      val text = parseHypothesis(rec.finalResult, "text") ?: ""
      mapOf(
        "text" to text,
        "isFinal" to true,
        "confidence" to 0.8,
      )
    }

    AsyncFunction("unload") {
      unloadInternal()
    }
  }

  private fun unloadInternal() {
    try {
      recognizer?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Recognizer close failed", e)
    }
    try {
      model?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Model close failed", e)
    }
    recognizer = null
    model = null
    loaded = false
  }

  private fun parseHypothesis(hypothesis: String?, key: String): String? {
    if (hypothesis.isNullOrBlank()) return null
    return try {
      JSONObject(hypothesis).optString(key, "").trim().ifEmpty { null }
    } catch (_: Throwable) {
      null
    }
  }

  companion object {
    private const val TAG = "SacVosk"
    const val DEFAULT_MODEL_ASSET = "model-en-us"
  }
}
