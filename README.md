# WBMQTTImport


# Wiren Board MQTT connector for Z-Way

Subscribe to the status of devices of Wiren Board 7 internal MQTT and creates devices in Z-Way for each topic.

# Installation

1. Install module:
```shell
        # Execute on Wiren Board
        apt install git
        cd /opt/z-way-server/automation/userModules
        git clone https://github.com/Z-Wave-Me/WBMQTTImport.git WBMQTTImport
```
1. To update to last version in this repo:
```shell
        cd /opt/z-way-server/automation/userModules/WBMQTTImport
        git pull
```
# Usage

Add an instance of the app through Z-Wave interface (Menu - Apps - Local Apps). No configuration needed. All configuration fields are skipped.
