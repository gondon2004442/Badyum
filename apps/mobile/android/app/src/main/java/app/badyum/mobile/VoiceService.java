package app.badyum.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Сервис, который держит разговор живым, пока приложение свёрнуто.
 *
 * Он существует ради одного правила Android: начиная с девятой версии система
 * отбирает микрофон у приложения, ушедшего в фон. Не приглушает — именно
 * отбирает, поток замолкает. Ровно это и видел человек, жаловавшийся, что
 * стоит выйти в галерею за картинкой, и его перестают слышать. Исключение
 * одно — приложение с работающим foreground-сервисом типа microphone, и весь
 * этот класс нужен, чтобы такой сервис появился.
 *
 * Звуком он не занимается вообще: не трогает режим аудио, не перехватывает
 * маршрутизацию, не запрашивает фокус. Это сознательно. Внутри WebView звонком
 * уже управляет движок браузера, и в открытом приложении он работает верно —
 * значит любое вмешательство отсюда способно только испортить то, что цело.
 * Задача сервиса — чтобы процесс не убили и микрофон не отняли, не более.
 */
public class VoiceService extends Service {

    /** Идентификатор уведомления. Оно одно, поэтому значение любое. */
    private static final int NOTIFICATION_ID = 1;

    private static final String CHANNEL_ID = "voice";

    @Override
    public IBinder onBind(Intent intent) {
        // Наружу сервис ничего не отдаёт: им управляют через startService/stopService.
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Badyum")
            .setContentText("Идёт разговор")
            .setSmallIcon(R.drawable.ic_voice)
            .setContentIntent(openApp())
            // Уведомление нельзя смахнуть: пока оно висит, работает микрофон, и
            // человек должен видеть это постоянно, а не до случайного свайпа.
            .setOngoing(true)
            // Разговор идёт прямо сейчас — уведомление про текущее состояние, а
            // не про случившееся событие.
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            /*
              Тип обязателен с десятой версии, а с четырнадцатой за него ещё и
              спрашивают отдельное разрешение. Без явного microphone система
              откажется поднимать сервис — и мы вернёмся ровно к той поломке,
              ради которой он заведён.
            */
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        /*
          Не перезапускаться после того, как нас убили.

          START_STICKY вернул бы сервис к жизни с пустым Intent — то есть
          микрофон снова оказался бы занят, хотя разговора уже нет. Выход из
          канала должен выключать сервис насовсем.
        */
        return START_NOT_STICKY;
    }

    /** Нажатие на уведомление возвращает в приложение, а не открывает его заново. */
    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        // MainActivity объявлена как singleTask: существующее окно поднимается
        // вместе с открытым каналом, вместо того чтобы стартовать второе.
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // С двенадцатой версии изменяемость обязана быть указана явно.
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        return PendingIntent.getActivity(this, 0, intent, flags);
    }

    /**
     * Канал уведомлений.
     *
     * Важность низкая нарочно: уведомление сообщает, что разговор идёт, и
     * звенеть при этом ему незачем — звук в наушниках и так есть.
     */
    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Разговор",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Показывает, что микрофон занят разговором в Badyum");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
