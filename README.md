# WBMQTTImport


# ZigBee2MQTT connector for Z-Way

Subscribe to the status of devices of ZigBee2MQTT internal MQTT and creates devices in Z-Way for each topic.

# Installation

1. Install module:
```shell
        # Execute on Wiren Board
        apt install git
        cd /opt/z-way-server/automation/userModules
        git clone https://github.com/msazanov/WBMQTTImport.git ZigBee2MQTT4Z-Way
```
1. To update to last version in this repo:
```shell
        cd /opt/z-way-server/automation/userModules/ZigBee2MQTT4Z-Way
        git pull
```
# Usage

Add an instance of the app through Z-Wave interface (Menu - Apps - Local Apps). No configuration needed. All configuration fields are skipped.
