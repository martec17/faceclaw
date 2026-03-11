package com.picoclaw.app;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "PicoClaw";
    private static final String SERVER_BINARY = "server-arm64";
    private Process serverProcess;

    @Override
    public void onStart() {
        super.onStart();
        startGoServer();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (serverProcess != null) {
            serverProcess.destroy();
            serverProcess = null;
        }
    }

    private void startGoServer() {
        new Thread(() -> {
            try {
                File serverFile = copyBinaryFromAssets(SERVER_BINARY);
                if (serverFile == null) {
                    Log.e(TAG, "Falha ao extrair binário do servidor");
                    return;
                }

                // Garantir permissão de execução
                if (!serverFile.setExecutable(true, false)) {
                    Log.w(TAG, "Não foi possível definir permissão de execução");
                }

                ProcessBuilder pb = new ProcessBuilder(serverFile.getAbsolutePath());
                pb.environment().put("PORT", "11435");
                pb.redirectErrorStream(true);
                serverProcess = pb.start();

                Log.i(TAG, "Servidor Go iniciado em :11435");

                // Log da saída do servidor
                new Thread(() -> {
                    try {
                        byte[] buf = new byte[1024];
                        int n;
                        while ((n = serverProcess.getInputStream().read(buf)) != -1) {
                            Log.d(TAG, "[server] " + new String(buf, 0, n).trim());
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Leitura do servidor encerrada: " + e.getMessage());
                    }
                }).start();

            } catch (Exception e) {
                Log.e(TAG, "Erro ao iniciar servidor Go: " + e.getMessage(), e);
            }
        }).start();
    }

    private File copyBinaryFromAssets(String assetName) {
        try {
            File outFile = new File(getFilesDir(), assetName);

            // Sempre reinstalar para garantir versão atualizada
            try (InputStream in = getAssets().open(assetName);
                    OutputStream out = new FileOutputStream(outFile)) {
                byte[] buf = new byte[8192];
                int len;
                while ((len = in.read(buf)) > 0)
                    out.write(buf, 0, len);
            }

            return outFile;
        } catch (Exception e) {
            Log.e(TAG, "Erro ao copiar binário: " + e.getMessage(), e);
            return null;
        }
    }
}
