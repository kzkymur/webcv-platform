#include <Arduino.h>
#include <Wire.h>
#include "XY2_100.h"

#define PWM_OUT_PIN (4)
#define GALVO_ENABLE_PIN (3)
#define I2C_DAC_ADDR (0x60) // 0b1100000 (7bit address)

//! ガルバノスキャナ
XY2_100* galvo;
int x, y, vol;

void processCommand(const String& line) {
    if (line.length() == 0) return;
    const char mode = line.charAt(0);
    const String payload = line.substring(1);

    if (mode == 'A') {
        // レーザー制御関連
        vol = payload.toInt();
        float val = (float)vol / 100.0;
        val *= 4005.0;
        uint16_t duty = static_cast<uint16_t>(val);

        // PWM出力
        analogWrite(PWM_OUT_PIN, duty);

        // 13ピンのLEDをトグル
        analogWrite(13, duty);

        // DAC出力
        Wire.beginTransmission(I2C_DAC_ADDR);
        Wire.write((duty >> 8) & 0x0F);
        Wire.write(duty);
        Wire.endTransmission();
        return;
    }

    if (mode == 'B') {
        // ガルバノスキャナ制御
        digitalWrite(GALVO_ENABLE_PIN, 1);
        const int commaIndex = payload.indexOf(',');
        if (commaIndex > 0) {
            x = payload.substring(0, commaIndex).toInt();
            y = payload.substring(commaIndex + 1).toInt();
            galvo->setXY(x, y);
        }
    }
}

void setup() {
    pinMode(13, OUTPUT);
    analogWrite(13, LOW);
    Serial.begin(115200);
    Serial.setTimeout(5);

    // レーザー制御用PWM出力
    pinMode(PWM_OUT_PIN, OUTPUT);
    analogWriteResolution(12);

    // I2C（DAC用）
    Wire.begin();
    Wire.beginTransmission(I2C_DAC_ADDR);
    Wire.write(B01100000); // 全メモリ書き込み, VREF1/0=0 PD1/0=0 G=0
    Wire.write(B00000000); // 0x00
    Wire.write(B00000000); // 0x00
    Wire.endTransmission();

    // ガルバノスキャナ初期化
    pinMode(GALVO_ENABLE_PIN, OUTPUT);
    galvo = new XY2_100();
    galvo->begin();
}

void loop() {
    while (Serial.available()) {
        const String line = Serial.readStringUntil('\n');
        processCommand(line);
    }
}
