#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ArduinoOTA.h>
#include "config.hpp"

#define INTERNAL_LED_PIN 2

#define BLINK_TIMEOUT 500

uint32_t blinkTime;

// Connect to the WiFi network with config.cpp values
void wifi_connect() {
    Serial.print("\nConnecting to ");
    Serial.print(wifi_ssid);
    Serial.print("...");

    WiFi.begin(wifi_ssid, wifi_password);
    while (WiFi.status() != WL_CONNECTED) {
        Serial.print(".");
        delay(500);
    }
    Serial.print("\nConnected to WiFi, IP address: ");
    Serial.println(WiFi.localIP());
}

// Init OTA and set some serial log handlers
void ota_start() {
    ArduinoOTA.setPort(8123);
    ArduinoOTA.setPassword((const char *)"eopS054jWKnDVXH5h6CMD8frfssjOJDe");

    ArduinoOTA.onStart([]() {
        Serial.println("OTA Start");
    });
    ArduinoOTA.onEnd([]() {
        Serial.println("OTA End");
        Serial.println("Rebooting...");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("Progress: %u%%\r\n", (progress / (total / 100)));
    });
    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf("Error %u: ", error);
        if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
        if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
        if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
        if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
        if (error == OTA_END_ERROR) Serial.println("End Failed");
    });

    ArduinoOTA.begin();
    Serial.println("ArduinoOTA started...");
}

void setup() {
    Serial.begin(9600);

    pinMode(INTERNAL_LED_PIN, OUTPUT);
    digitalWrite(INTERNAL_LED_PIN, LOW);

    wifi_connect();

    ota_start();

    blinkTime = millis();
}

void loop() {
    ArduinoOTA.handle();

    // Blink the internal LED for fun
    if (millis() - blinkTime >= BLINK_TIMEOUT) {
        digitalWrite(INTERNAL_LED_PIN, !digitalRead(INTERNAL_LED_PIN));
        blinkTime = millis();
    }
}
