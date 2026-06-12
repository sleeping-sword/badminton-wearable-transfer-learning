import Toybox.Communications;
import Toybox.System;

class PhoneTransmitListener extends Communications.ConnectionListener {

    function initialize() {
        ConnectionListener.initialize();
    }

    function onComplete() {
        System.println("Transmit OK");
    }

    function onError() {
        System.println("Transmit ERROR");
    }
}

