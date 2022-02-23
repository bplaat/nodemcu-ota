#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ArduinoOTA.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include "config.hpp"

#define INTERNAL_LED_PIN 2
#define INTERNAL_LED2_PIN 16

using namespace websockets;

WebsocketsClient client;

bool internal_led = false;

// Connect to the WiFi network with config.cpp values
void wifi_connect() {
    Serial.print("\nConnecting to ");
    Serial.print(wifi_ssid);

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
    ArduinoOTA.setPassword(device_key);

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

void websockets_connect() {
    client.connect(websockets_url);

    // Send devices connect message
    StaticJsonDocument<512> doc;
    JsonObject messageJson = doc.to<JsonObject>();
    messageJson["id"] = millis();
    messageJson["type"] = "devices.connect";
    JsonObject dataJson = messageJson.createNestedObject("data");
    dataJson["key"] = device_key;
    String connectMessage;
    serializeJson(doc, connectMessage);
    client.send(connectMessage);

    client.onMessage([](WebsocketsMessage msg) {
        // Parse incoming messages
        StaticJsonDocument<512> doc;
        deserializeJson(doc, msg.data());
        Serial.print("RECEIVE ");
        Serial.println(msg.data());

        // Listen to device value changes
        if (doc["type"] == "devices.connect") {
            JsonArray values = doc["data"]["values"];
            for (JsonObject value : values) {
                if (value["name"] == "internal_led") {
                    internal_led = value["value"];
                }
            }
        }
        if (doc["type"] == "values.update") {
            if (doc["data"]["value"]["name"] == "internal_led") {
                internal_led = doc["data"]["value"]["value"];
            }
        }
    });
}

void setup() {
    Serial.begin(9600);

    pinMode(INTERNAL_LED_PIN, OUTPUT);
    digitalWrite(INTERNAL_LED_PIN, HIGH); // Reversed
    pinMode(INTERNAL_LED2_PIN, OUTPUT);
    digitalWrite(INTERNAL_LED2_PIN, HIGH); // Reversed

    wifi_connect();
    ota_start();
    websockets_connect();
}

void loop() {
    ArduinoOTA.handle();
    client.poll();

    // Reflect online device values
    digitalWrite(INTERNAL_LED_PIN, internal_led ? LOW : HIGH); // Reversed
}
