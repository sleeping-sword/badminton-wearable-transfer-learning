import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class EnterApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    // onStart() is called on application start up
    function onStart(state as Dictionary?) as Void {
    }

    // onStop() is called when your application is exiting
    function onStop(state as Dictionary?) as Void {
    }

    // Return the initial view of your application here
    function getInitialView() as [Views] or [Views, InputDelegates] {
        // return [ new EnterView(), new EnterDelegate() ];
        var view = new EnterView();
        return [ view, new EnterDelegate(view) ];
    }

}

function getApp() as EnterApp {
    return Application.getApp() as EnterApp;
}