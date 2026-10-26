#include <SPI.h>
#include <MFRC522.h>

#define RFID_SS_PIN 16
#define RFID_RST_PIN 17
#define RFID_SCK_PIN 22
#define RFID_MISO_PIN 13
#define RFID_MOSI_PIN 21
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
unsigned long previousStatusMillis = 0;
const unsigned long statusInterval = 1000;

void mulaiRFID() {
  rfid.PCD_Reset(); delay(50);
  rfid.PCD_Init(); delay(100);
  rfid.PCD_AntennaOn();
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_avg);
  delay(100);
}
void tampilkanUID() {
  Serial.print("UID : ");
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) Serial.print("0");
    Serial.print(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) Serial.print(":");
  }
  Serial.println();
}
void setup() {
  Serial.begin(115200); delay(1000);
  Serial.println();
  Serial.println("=================================");
  Serial.println("     TEST RFID RC522 - ESP32");
  Serial.println("=================================");
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  mulaiRFID();
  byte versi = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("Versi chip RC522: 0x");
  if (versi < 0x10) Serial.print("0");
  Serial.println(versi, HEX);
  if (versi == 0x00 || versi == 0xFF) {
    Serial.println("RC522 TIDAK MERESPONS!");
    Serial.println("Periksa kabel, pin, 3V3, dan GND.");
  } else {
    Serial.println("RC522 terhubung.");
    Serial.println("Angkat kartu, kemudian tempelkan kembali.");
  }
  Serial.println();
}
void loop() {
  if (!rfid.PICC_IsNewCardPresent()) {
    if (millis() - previousStatusMillis >= statusInterval) {
      previousStatusMillis = millis();
      Serial.println("STATUS : MENUNGGU KARTU...");
    }
    return;
  }
  Serial.println(); Serial.println("Sinyal kartu terdeteksi...");
  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("STATUS : UID GAGAL DIBACA");
    Serial.println("Angkat kartu, lalu tempelkan kembali.");
    mulaiRFID(); delay(500); return;
  }
  Serial.println("=================================");
  Serial.println("KARTU BERHASIL DIBACA");
  Serial.println("=================================");
  tampilkanUID();
  Serial.println("STATUS : TERVERIFIKASI");
  Serial.println("================================="); Serial.println();
  rfid.PICC_HaltA(); rfid.PCD_StopCrypto1(); delay(1000);
}
