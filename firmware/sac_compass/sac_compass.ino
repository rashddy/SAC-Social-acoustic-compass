/*
 * Social Acoustic Compass — SAC-Compass BLE firmware
 * -------------------------------------------------
 * Advertises as SAC-Compass, Nordic UART TX Notify, then streams:
 *   ASCII / 0xA0  → direction (locked mic)
 *   0xA1          → int16 LE mono PCM @ 8 kHz from the locked INMP441
 *
 * EDIT THE I2S PINS below to match your wiring. Defaults match the
 * common 3× INMP441 layout used by the necklace sketch.
 *
 * Arduino IDE: board ESP32 / ESP32-S3, folder name == sac_compass.
 * Serial 115200 — look for "Advertising" and "TX Notify enabled".
 */

#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================= Nordic UART (must match the app) =================
#define DEVICE_NAME          "SAC-Compass"
#define NUS_SERVICE_UUID     "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID          "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_UUID          "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

#define OPCODE_DIR           0xA0
#define OPCODE_PCM           0xA1
#define LOCK_LEFT            1
#define LOCK_FRONT           2
#define LOCK_RIGHT           3

// ================= Audio / BLE packet sizing =================
#define SAMPLE_RATE          8000
#define PCM_SAMPLE_RATE_KHZ  8
#define FRAME_SAMPLES        40          // 5 ms @ 8 kHz per BLE notify
#define PCM_SAMPLES_PER_PKT  FRAME_SAMPLES

// ================= I2S pins (EDIT to match your board) =================
// Bus 0 MASTER stereo: Front = Left, Right = Right (INMP441 L/R select)
#define I2S0_BCLK  GPIO_NUM_4
#define I2S0_WS    GPIO_NUM_5
#define I2S0_SD    GPIO_NUM_6

// Bus 1 SLAVE mono: Left mic. Tie BCLK/WS to the same nets as I2S0.
#define I2S1_BCLK  GPIO_NUM_4
#define I2S1_WS    GPIO_NUM_5
#define I2S1_SD    GPIO_NUM_7

// Set 0 if you only wired one mic on I2S0 Left (Front) — STT still works.
#ifndef SAC_HAS_THREE_MICS
#define SAC_HAS_THREE_MICS 1
#endif

// ================= Onset / lock =================
#define NOISE_FLOOR_ALPHA  0.97f
#define ONSET_MULTIPLIER   1.7f
#define HOLD_LOCK_MS       500
#define DIR_REFRESH_MS     80

static BLECharacteristic *txChar = nullptr;
static volatile bool deviceConnected = false;
static volatile bool notificationsEnabled = false;

static int32_t rawAB[FRAME_SAMPLES * 2];
static int32_t rawC[FRAME_SAMPLES];
static int16_t micFront[FRAME_SAMPLES];
static int16_t micRight[FRAME_SAMPLES];
static int16_t micLeft[FRAME_SAMPLES];

static float noiseFloor = 40.0f;
static uint8_t lockedZone = LOCK_FRONT;
static uint32_t lockUntilMs = 0;
static uint32_t lastDirMs = 0;
static uint32_t pcmPackets = 0;
static bool wasLocked = false;
static uint8_t lastSentZone = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    deviceConnected = true;
    notificationsEnabled = false;
    Serial.println("[BLE] connected — waiting for TX Notify");
  }
  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    notificationsEnabled = false;
    Serial.println("[BLE] disconnected — advertising");
    delay(400);
    server->startAdvertising();
    BLEDevice::startAdvertising();
  }
};

class CccdCallbacks : public BLEDescriptorCallbacks {
  void onWrite(BLEDescriptor *d) override {
    uint8_t *v = d->getValue();
    size_t n = d->getLength();
    notificationsEnabled = (n >= 2 && (v[0] & 0x01));
    Serial.println(notificationsEnabled ? "[BLE] TX Notify ON" : "[BLE] TX Notify OFF");
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    Serial.printf("[BLE] RX %u bytes\n", (unsigned)c->getValue().length());
  }
};

static int16_t degreesForZone(uint8_t locked) {
  if (locked == LOCK_LEFT) return -90;
  if (locked == LOCK_RIGHT) return 90;
  return 0;
}

static const char *labelForZone(uint8_t locked) {
  if (locked == LOCK_LEFT) return "LEFT";
  if (locked == LOCK_RIGHT) return "RIGHT";
  return "FRONT";
}

static float frameEnergy(const int16_t *buf, int n) {
  float sum = 0;
  for (int i = 0; i < n; i++) sum += fabsf((float)buf[i]);
  return sum / (float)n;
}

static void i2sInit() {
  i2s_config_t cfg0 = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = FRAME_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins0 = {
    .bck_io_num = I2S0_BCLK,
    .ws_io_num = I2S0_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S0_SD
  };
  i2s_driver_install(I2S_NUM_0, &cfg0, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins0);

#if SAC_HAS_THREE_MICS
  i2s_config_t cfg1 = {
    .mode = (i2s_mode_t)(I2S_MODE_SLAVE | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = FRAME_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins1 = {
    .bck_io_num = I2S1_BCLK,
    .ws_io_num = I2S1_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S1_SD
  };
  i2s_driver_install(I2S_NUM_1, &cfg1, 0, NULL);
  i2s_set_pin(I2S_NUM_1, &pins1);
#endif
}

/** Read one frame. INMP441 is typically 24-bit left-justified in 32-bit slots. */
static int16_t toPcm16(int32_t raw) {
  // >> 14 gives more speech level than >> 16 for many INMP441 boards.
  int32_t s = raw >> 14;
  if (s > 32767) s = 32767;
  if (s < -32768) s = -32768;
  return (int16_t)s;
}

static void readMicFrame() {
  size_t n0 = 0, n1 = 0;
  i2s_read(I2S_NUM_0, rawAB, sizeof(rawAB), &n0, portMAX_DELAY);
#if SAC_HAS_THREE_MICS
  i2s_read(I2S_NUM_1, rawC, sizeof(rawC), &n1, portMAX_DELAY);
#endif
  for (int i = 0; i < FRAME_SAMPLES; i++) {
    micFront[i] = toPcm16(rawAB[2 * i]);
    micRight[i] = toPcm16(rawAB[2 * i + 1]);
#if SAC_HAS_THREE_MICS
    micLeft[i] = toPcm16(rawC[i]);
#else
    micLeft[i] = micFront[i];
#endif
  }
}

static const int16_t *samplesForZone(uint8_t zone) {
  if (zone == LOCK_LEFT) return micLeft;
  if (zone == LOCK_RIGHT) return micRight;
  return micFront;
}

static uint8_t pickLoudestZone(float eL, float eF, float eR) {
  if (eL >= eF && eL >= eR) return LOCK_LEFT;
  if (eR >= eF && eR >= eL) return LOCK_RIGHT;
  return LOCK_FRONT;
}

static void sendAsciiDirection(uint8_t locked) {
  char line[24];
  int n = snprintf(line, sizeof(line), "SAC|%s|%d\n",
                   labelForZone(locked), (int)degreesForZone(locked));
  txChar->setValue((uint8_t *)line, n);
  txChar->notify();
}

static void sendBinaryDirection(uint8_t locked, uint16_t rmsL, uint16_t rmsF, uint16_t rmsR) {
  uint8_t pkt[11];
  int16_t deg = degreesForZone(locked);
  pkt[0] = OPCODE_DIR;
  pkt[1] = locked;
  pkt[2] = (uint8_t)(deg & 0xFF);
  pkt[3] = (uint8_t)((deg >> 8) & 0xFF);
  pkt[4] = rmsL & 0xFF; pkt[5] = (rmsL >> 8) & 0xFF;
  pkt[6] = rmsF & 0xFF; pkt[7] = (rmsF >> 8) & 0xFF;
  pkt[8] = rmsR & 0xFF; pkt[9] = (rmsR >> 8) & 0xFF;
  pkt[10] = 0;
  txChar->setValue(pkt, sizeof(pkt));
  txChar->notify();
}

/** Real mic PCM for live STT — header + sampleCount × int16 LE. */
static void sendPcmChunk(uint8_t locked, const int16_t *samples) {
  uint8_t pkt[4 + PCM_SAMPLES_PER_PKT * 2];
  pkt[0] = OPCODE_PCM;
  pkt[1] = locked;
  pkt[2] = (uint8_t)PCM_SAMPLES_PER_PKT;
  pkt[3] = PCM_SAMPLE_RATE_KHZ;
  for (int i = 0; i < PCM_SAMPLES_PER_PKT; i++) {
    int16_t s = samples[i];
    pkt[4 + i * 2] = (uint8_t)(s & 0xFF);
    pkt[4 + i * 2 + 1] = (uint8_t)((s >> 8) & 0xFF);
  }
  txChar->setValue(pkt, 4 + PCM_SAMPLES_PER_PKT * 2);
  txChar->notify();
  pcmPackets++;
}

static void startAdvertising() {
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising as " DEVICE_NAME);
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("=== SAC-Compass (mic → 0xA1 @ 8 kHz) ===");

  i2sInit();
  Serial.println("[I2S] ready — speak toward a mic after Notify is on");

  BLEDevice::init(DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *nus = server->createService(NUS_SERVICE_UUID);
  txChar = nus->createCharacteristic(
    NUS_TX_UUID,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  BLE2902 *cccd = new BLE2902();
  cccd->setCallbacks(new CccdCallbacks());
  txChar->addDescriptor(cccd);

  BLECharacteristic *rx = nus->createCharacteristic(
    NUS_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(new RxCallbacks());

  nus->start();
  startAdvertising();
}

void loop() {
  if (deviceConnected && txChar != nullptr) {
    BLE2902 *cccd = (BLE2902 *)txChar->getDescriptor(BLEUUID((uint16_t)0x2902));
    if (cccd != nullptr) {
      bool on = cccd->getNotifications();
      if (on != notificationsEnabled) {
        notificationsEnabled = on;
        Serial.println(on ? "[BLE] TX Notify ON (polled)" : "[BLE] TX Notify OFF (polled)");
      }
    }
  }

  // Always read mics so noise floor tracks even before Notify.
  readMicFrame();

  float eF = frameEnergy(micFront, FRAME_SAMPLES);
  float eR = frameEnergy(micRight, FRAME_SAMPLES);
  float eL = frameEnergy(micLeft, FRAME_SAMPLES);
  float eMax = eF;
  if (eR > eMax) eMax = eR;
  if (eL > eMax) eMax = eL;

  uint32_t now = millis();
  bool speaking = eMax > ONSET_MULTIPLIER * noiseFloor;
  if (!speaking) {
    noiseFloor = NOISE_FLOOR_ALPHA * noiseFloor + (1.0f - NOISE_FLOOR_ALPHA) * eMax;
  } else {
    lockedZone = pickLoudestZone(eL, eF, eR);
    lockUntilMs = now + HOLD_LOCK_MS;
  }

  bool locked = speaking || (now < lockUntilMs);

  if (!deviceConnected || !notificationsEnabled) {
    delay(1);
    return;
  }

  if (locked) {
    const bool lockEdge = !wasLocked || lockedZone != lastSentZone;
    // Direction first on lock / zone hop so the phone radar moves immediately.
    if (lockEdge || (now - lastDirMs >= DIR_REFRESH_MS)) {
      lastDirMs = now;
      lastSentZone = lockedZone;
      sendBinaryDirection(
        lockedZone,
        (uint16_t)constrain((int)eL, 0, 65535),
        (uint16_t)constrain((int)eF, 0, 65535),
        (uint16_t)constrain((int)eR, 0, 65535)
      );
      if (lockEdge) sendAsciiDirection(lockedZone);
    }
    sendPcmChunk(lockedZone, samplesForZone(lockedZone));
    if ((pcmPackets % 200) == 0) {
      Serial.printf("[PCM] packets=%lu zone=%s eMax=%.1f\n",
                    (unsigned long)pcmPackets, labelForZone(lockedZone), eMax);
    }
  } else {
    delay(2);
  }
  wasLocked = locked;
}
