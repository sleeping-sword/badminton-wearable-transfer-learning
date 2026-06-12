import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;
import Toybox.Sensor;
import Toybox.Application.Storage;
import Toybox.Communications;

class EnterView extends WatchUi.View {

    var isRecording = false;
    var accMaxRate  = 25;
    var gyroMaxRate = 25;

    var accSampleCount  = 0;
    var gyroSampleCount = 0;
    var startTimeMs     = 0;
    var durationSec     = 0.0;

    var chunkIndex      = 0;
    var savedChunkCount = 0;

    function initialize() {
        View.initialize();
    }

    function onLayout(dc as Dc) as Void {
        setLayout(Rez.Layouts.WatchFace(dc));
    }

    function onShow() as Void {
        var ar = Sensor.getMaxSampleRateForSensorType(:accelerometer);
        var gr = Sensor.getMaxSampleRateForSensorType(:gyroscope);
        accMaxRate  = (ar > 0 && ar < 25) ? ar : 25;
        gyroMaxRate = (gr > 0 && gr < 25) ? gr : 25;
    }

    function onUpdate(dc as Dc) as Void {
        var label;
        if (isRecording) {
            label = "REC " + accSampleCount;
        } else {
            label = "v3 Ready:" + accSampleCount;
        }
        var v = View.findDrawableById("TimeLabel") as Text;
        v.setText(label);
        View.onUpdate(dc);
    }

    function onHide()       as Void {}
    function onExitSleep()  as Void {}
    function onEnterSleep() as Void {}

    function toggleRecording() {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    function startRecording() {
        accSampleCount  = 0;
        gyroSampleCount = 0;
        chunkIndex      = 0;
        savedChunkCount = 0;
        startTimeMs     = System.getTimer();
        isRecording     = true;

        var options = {
            :period      => 1,
            :synchronous => true,
            :accelerometer => { :enabled => true, :sampleRate => accMaxRate  },
            :gyroscope    => { :enabled => true, :sampleRate => gyroMaxRate }
        };
        Sensor.registerSensorDataListener(method(:onSensorData), options);
        WatchUi.requestUpdate();
    }

    function stopRecording() {
        Sensor.unregisterSensorDataListener();
        durationSec = (System.getTimer() - startTimeMs) / 1000.0;
        isRecording = false;

        var allAccX  = [];
        var allAccY  = [];
        var allAccZ  = [];
        var allGyroX = [];
        var allGyroY = [];
        var allGyroZ = [];

        for (var i = 0; i < savedChunkCount; i++) {
            var raw = Storage.getValue("chunk_" + i);
            if (!(raw instanceof Dictionary)) { continue; }
            var chunk = raw as Dictionary;
            var ax = chunk.get("accX");
            var gx = chunk.get("gyroX");
            if (ax instanceof Array) {
                var ay = chunk.get("accY"); var az = chunk.get("accZ");
                for (var j = 0; j < ax.size(); j++) {
                    allAccX.add(ax[j]); allAccY.add(ay[j]); allAccZ.add(az[j]);
                }
            }
            if (gx instanceof Array) {
                var gy = chunk.get("gyroY"); var gz = chunk.get("gyroZ");
                for (var j = 0; j < gx.size(); j++) {
                    allGyroX.add(gx[j]); allGyroY.add(gy[j]); allGyroZ.add(gz[j]);
                }
            }
        }

        // 限制最多 100 筆（避免超過 8KB 傳輸上限）
        var maxN = 100;
        var n = allAccX.size();
        if (n > maxN) { n = maxN; }

        var trimAccX  = allAccX.slice(0, n);
        var trimAccY  = allAccY.slice(0, n);
        var trimAccZ  = allAccZ.slice(0, n);
        var trimGyroX = allGyroX.slice(0, n);
        var trimGyroY = allGyroY.slice(0, n);
        var trimGyroZ = allGyroZ.slice(0, n);

        var data = {
            "type"       => "alldata",
            "sampleRate" => accMaxRate,
            "duration"   => durationSec,
            "count"      => n,
            "accX"       => trimAccX,
            "accY"       => trimAccY,
            "accZ"       => trimAccZ,
            "gyroX"      => trimGyroX,
            "gyroY"      => trimGyroY,
            "gyroZ"      => trimGyroZ
        };
        Communications.transmit(data, null, new PhoneTransmitListener());
        WatchUi.requestUpdate();
    }

    function onSensorData(sensorData as Sensor.SensorData) as Void {
        var accData  = sensorData.accelerometerData;
        var gyroData = sensorData.gyroscopeData;

        if (accData != null)  { accSampleCount  += accData.x.size(); }
        if (gyroData != null) { gyroSampleCount += gyroData.x.size(); }

        var chunk = {
            "accX"  => accData  != null ? accData.x  : [],
            "accY"  => accData  != null ? accData.y  : [],
            "accZ"  => accData  != null ? accData.z  : [],
            "gyroX" => gyroData != null ? gyroData.x : [],
            "gyroY" => gyroData != null ? gyroData.y : [],
            "gyroZ" => gyroData != null ? gyroData.z : []
        };
        Storage.setValue("chunk_" + chunkIndex, chunk);
        chunkIndex++;
        savedChunkCount = chunkIndex;
        WatchUi.requestUpdate();
    }
}