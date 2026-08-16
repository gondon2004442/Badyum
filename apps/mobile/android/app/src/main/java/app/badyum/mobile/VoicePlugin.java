package app.badyum.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Мост между страницей и фоновым сервисом.
 *
 * Страница живёт в WebView и про Android ничего не знает; всё, что ей нужно, —
 * сказать «разговор начался» и «разговор закончился». Отсюда ровно два метода.
 *
 * Запрос разрешений намеренно устроен так, что отказ ничего не ломает: см.
 * комментарий у {@link #start}.
 */
@CapacitorPlugin(
    name = "Voice",
    permissions = {
        @Permission(alias = VoicePlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class VoicePlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    /**
     * Включить фоновый режим разговора.
     *
     * Зовётся уже после того, как микрофон захвачен: к этому моменту право
     * RECORD_AUDIO точно выдано, а без него система откажется поднимать сервис
     * типа microphone.
     */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), VoiceService.class));
        } catch (Exception error) {
            /*
              С двенадцатой версии поднять такой сервис из фона нельзя, и
              попытка кидает исключение. Мы стартуем из обработчика нажатия, то
              есть с переднего плана, но подстраховаться стоит: разговор без
              фонового режима лучше, чем приложение, упавшее при входе в канал.
            */
            call.reject("не удалось включить фоновый режим", error);
            return;
        }

        /*
          Разрешение на уведомления просим уже после старта сервиса.

          С тринадцатой версии Android без него уведомление не показать, но сам
          сервис при этом работает — а работа сервиса и есть цель: звук в фоне
          важнее плашки в шторке. Поэтому порядок именно такой: сначала
          разговор продолжает жить, а потом отдельным вопросом решается, будет
          ли человек это видеть. Иначе отказ на диалоге оставлял бы его без
          фонового звука, и связь между двумя вещами он бы не установил.
        */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notificationsGranted()) {
            requestPermissionForAlias(NOTIFICATIONS, call, "afterNotifications");
            return;
        }

        call.resolve();
    }

    /**
     * Ответ на запрос разрешения.
     *
     * Что именно ответили, не проверяем: сервис к этому моменту уже поднят, и
     * разрешение влияет только на видимость уведомления. Метод нужен, потому
     * что Capacitor требует обработчик для каждого запроса прав.
     */
    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        call.resolve();
    }

    private boolean notificationsGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Выключить: разговор закончился, микрофон больше не нужен. */
    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), VoiceService.class));
        call.resolve();
    }
}
