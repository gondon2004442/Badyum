import { GoogleButton } from "../../components/GoogleButton.tsx";
import { Pitch } from "../../components/Pitch.tsx";
import { startLogin, useAccount } from "../../account.ts";
import "./Login.css";

interface LoginScreenProps {
  /**
   * Пройти мимо входа и дальше жить гостем.
   *
   * Нажимается один раз на устройство: второй раз спрашивать человека, который
   * уже ответил, значит не услышать ответа.
   */
  onSkip: () => void;
}

/**
 * Первый экран нового человека.
 *
 * Показывается ровно тому, кто пришёл на пустое место: без ссылки, без
 * аккаунта и без следов прошлых заходов. Пришедшего по ссылке он не видит
 * никогда — там вход не нужен вовсе, и подсовывать ему Google значит требовать
 * регистрацию там, где мы обещали обойтись без неё.
 *
 * Вход один — через Google, и развилки здесь нет намеренно. Кнопки «у меня
 * есть ссылка» не существует: ссылку не вводят руками, по ней переходят. Зато
 * есть выход для того, кому продиктовали кодовое слово, — строкой в сноске, а
 * не второй кнопкой: спорить с главным действием ей не за что.
 *
 * Заливки акцентом на этом экране нет ни одной. Главная кнопка тут
 * гугловская, её канон запрещает свои цвета, и фиолетовая кнопка рядом
 * читалась бы как более важная, чем та, ради которой сюда пришли.
 */
export function LoginScreen({ onSkip }: LoginScreenProps) {
  const account = useAccount();

  return (
    <div className="login">
      <Pitch />

      <main className="login__form">
        <div className="login__pane">
          {/*
            Знак — только на узком экране: там сцены с названием нет, и без него
            страница начиналась бы со слова «Заходи» неизвестно куда.
          */}
          <span className="login__mark" aria-hidden>
            B
          </span>
          <span className="login__kicker">Badyum</span>
          <h1 className="login__title">Заходи</h1>
          <p className="login__lead">
            Один вход — через Google. Он даёт юз, по которому тебя находят, и
            право заводить свои каналы.
          </p>

          <div className="login__act">
            <GoogleButton
              onClick={() => void startLogin()}
              disabled={account.loggingIn}
              label={account.loggingIn ? "Жду Google…" : "Войти через Google"}
            />
          </div>

          {/*
            Отказ входа надо произнести вслух. Сервер уводит сюда с меткой в
            адресе, и человек возвращается ровно на тот же экран: без этой
            строки он не отличит отказ от собственного промаха по кнопке.
          */}
          {account.loginProblem ? (
            <p className="login__problem" role="alert">
              {account.loginProblem}
            </p>
          ) : null}

          <div className="login__foot">
            <p className="login__note">
              Если тебе прислали ссылку на канал — <b>вход не нужен</b>: открой
              её и напиши имя. Аккаунт нужен, только чтобы завести свой канал.
            </p>
            {/*
              Кодовое слово — единственный способ попасть в канал без ссылки, и
              входа он тоже не требует. Не дать сюда дороги значило бы запереть
              человека, которому слово продиктовали вслух.
            */}
            <button className="login__skip" onClick={onSkip} type="button">
              Позвали по кодовому слову? Зайти без аккаунта
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
