import Toybox.WatchUi;
import Toybox.System;

class EnterDelegate extends WatchUi.BehaviorDelegate {

    var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onSelect() {
        System.println("SELECT pressed");
        view.toggleRecording();
        return true;
    }
}