package com.fortysidedstudio.lettorevocale;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Esegue il modello Kokoro con ONNX Runtime nativo (più thread, molto più veloce del WASM nel WebView).
 * La fonemizzazione resta in JavaScript: qui arrivano i token e il vettore di stile, e tornano i campioni audio.
 */
@CapacitorPlugin(name = "KokoroNative")
public class KokoroNativePlugin extends Plugin {
    private static final String MODEL_FILE = "kokoro-v1.0.int8.onnx";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private OrtEnvironment env;
    private OrtSession session;
    private String outputName;

    private File modelFile() {
        return new File(getContext().getFilesDir(), MODEL_FILE);
    }

    @PluginMethod
    public void status(PluginCall call) {
        File f = modelFile();
        JSObject r = new JSObject();
        r.put("downloaded", f.exists() && f.length() > 50_000_000L);
        r.put("bytes", f.exists() ? f.length() : 0);
        r.put("cores", Runtime.getRuntime().availableProcessors());
        call.resolve(r);
    }

    @PluginMethod
    public void download(PluginCall call) {
        final JSArray urls = call.getArray("urls");
        final long expected = call.getLong("expectedBytes", 92_361_271L);
        worker.execute(() -> {
            String lastError = "nessun indirizzo";
            File target = modelFile();
            File tmp = new File(target.getParentFile(), MODEL_FILE + ".part");
            try {
                for (int i = 0; urls != null && i < urls.length(); i++) {
                    String address = urls.getString(i);
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
                        c.setConnectTimeout(20_000);
                        c.setReadTimeout(30_000);
                        c.setInstanceFollowRedirects(true);
                        int code = c.getResponseCode();
                        if (code != 200) {
                            lastError = "HTTP " + code;
                            continue;
                        }
                        long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : expected;
                        long loaded = 0;
                        long lastNotify = 0;
                        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                            byte[] buf = new byte[64 * 1024];
                            int n;
                            while ((n = in.read(buf)) > 0) {
                                out.write(buf, 0, n);
                                loaded += n;
                                long now = System.currentTimeMillis();
                                if (now - lastNotify > 250) {
                                    lastNotify = now;
                                    JSObject p = new JSObject();
                                    p.put("loaded", loaded);
                                    p.put("total", total);
                                    notifyListeners("progress", p);
                                }
                            }
                        }
                        if (Math.abs(loaded - expected) > 1024) {
                            lastError = "dimensione inattesa (" + loaded + " byte)";
                            continue;
                        }
                        if (target.exists()) target.delete();
                        if (!tmp.renameTo(target)) throw new Exception("impossibile salvare il modello");
                        JSObject r = new JSObject();
                        r.put("bytes", loaded);
                        call.resolve(r);
                        return;
                    } catch (Exception e) {
                        lastError = String.valueOf(e.getMessage());
                    }
                }
            } catch (Exception e) {
                lastError = String.valueOf(e.getMessage());
            } finally {
                if (tmp.exists()) tmp.delete();
            }
            call.reject("Download non riuscito: " + lastError);
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        final int cores = Runtime.getRuntime().availableProcessors();
        final int threads = Math.max(1, Math.min(call.getInt("threads", Math.min(4, cores)), cores));
        worker.execute(() -> {
            try {
                releaseNow();
                env = OrtEnvironment.getEnvironment();
                try (OrtSession.SessionOptions o = new OrtSession.SessionOptions()) {
                    o.setIntraOpNumThreads(threads);
                    o.setInterOpNumThreads(1);
                    o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                    session = env.createSession(modelFile().getAbsolutePath(), o);
                }
                outputName = session.getOutputNames().iterator().next();
                JSObject r = new JSObject();
                r.put("threads", threads);
                r.put("cores", cores);
                call.resolve(r);
            } catch (Throwable e) {
                call.reject("Caricamento del modello nativo non riuscito: " + e);
            }
        });
    }

    @PluginMethod
    public void synth(PluginCall call) {
        final JSArray tokensJs = call.getArray("tokens");
        final JSArray styleJs = call.getArray("style");
        worker.execute(() -> {
            try {
                if (session == null) throw new IllegalStateException("modello non caricato");
                long started = System.nanoTime();
                int n = tokensJs.length();
                long[] tokens = new long[n];
                for (int i = 0; i < n; i++) tokens[i] = tokensJs.getLong(i);
                int m = styleJs.length();
                float[] style = new float[m];
                for (int i = 0; i < m; i++) style[i] = (float) styleJs.getDouble(i);

                Map<String, OnnxTensor> inputs = new HashMap<>();
                inputs.put("tokens", OnnxTensor.createTensor(env, LongBuffer.wrap(tokens), new long[] {1, n}));
                inputs.put("style", OnnxTensor.createTensor(env, FloatBuffer.wrap(style), new long[] {1, m}));
                inputs.put("speed", OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[] {1f}), new long[] {1}));
                try (OrtSession.Result result = session.run(inputs)) {
                    OnnxTensor audio = (OnnxTensor) result.get(outputName).get();
                    FloatBuffer fb = audio.getFloatBuffer();
                    int count = fb.remaining();
                    byte[] pcm = new byte[count * 2];
                    for (int i = 0; i < count; i++) {
                        float f = Math.max(-1f, Math.min(1f, fb.get(i)));
                        short s = (short) (f < 0 ? f * 32768f : f * 32767f);
                        pcm[2 * i] = (byte) (s & 0xff);
                        pcm[2 * i + 1] = (byte) ((s >> 8) & 0xff);
                    }
                    JSObject r = new JSObject();
                    r.put("pcm", Base64.encodeToString(pcm, Base64.NO_WRAP));
                    r.put("samples", count);
                    r.put("ms", (System.nanoTime() - started) / 1_000_000L);
                    call.resolve(r);
                } finally {
                    for (OnnxTensor t : inputs.values()) t.close();
                }
            } catch (Throwable e) {
                call.reject("Sintesi nativa non riuscita: " + e);
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        worker.execute(() -> {
            releaseNow();
            call.resolve();
        });
    }

    private void releaseNow() {
        try {
            if (session != null) session.close();
        } catch (Throwable ignored) {
        }
        session = null;
    }
}
