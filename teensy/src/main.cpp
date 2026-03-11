#include <Arduino.h>
#include <Wire.h>
#include "XY2_100.h"

#define PWM_OUT_PIN (4)
#define GALVO_ENABLE_PIN (3)
#define I2C_DAC_ADDR (0x60) // 0b1100000 (7bit address)

//! ガルバノスキャナ
XY2_100* galvo;

String buffer = "";
char mode;
int x, y, vol;
bool ledState = true;

void setup() {
    pinMode(13, OUTPUT);
    digitalWrite(13, ledState ? HIGH : LOW);
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
    if (Serial.available()) {
        buffer = Serial.readString();
        mode = buffer.charAt(0);
        buffer = buffer.substring(1);
    }

    if (mode == 'A') {
        // レーザー制御関連
        vol = buffer.toInt();
        float val = (float)vol / 100.0;
        val *= 4005.0;
        uint16_t duty = static_cast<uint16_t>(val);

        // PWM出力
        analogWrite(PWM_OUT_PIN, duty);

        // 13ピンのLEDをトグル
        ledState = !ledState;
        digitalWrite(13, ledState ? HIGH : LOW);

        // DAC出力
        // Wire.beginTransmission(I2C_DAC_ADDR);
        // Wire.write((duty >> 8) & 0x0F);
        // Wire.write(duty);
        // Wire.endTransmission();

    }
    if (mode == 'B') {
        // ガルバノスキャナ制御
        digitalWrite(GALVO_ENABLE_PIN, 1);
        int commaIndex = buffer.indexOf(',');
        if (commaIndex > 0) {
            x = buffer.substring(0, commaIndex).toInt();
            y = buffer.substring(commaIndex + 1).toInt();
        }
        galvo->setXY(x, y);
    }
}