import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { fetchInviteCode } from "../../api.ts";

/**
 * Свободное место в канале.
 *
 * Первый заход в пустой канал не должен быть тупиком: здесь сразу и ссылка,
 * и QR. Сценарий «сижу за ПК, беру телефон» закрывается наведением камеры,
 * без пересылки ссылки самому себе.
 */
export function InviteTile({ channelId }: { channelId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { code: inviteCode } = await fetchInviteCode(channelId);
        if (cancelled) return;
        setCode(inviteCode);

        const url = `${location.origin}/j/${inviteCode}`;
        const svg = await QRCode.toString(url, {
          type: "svg",
          margin: 0,
          color: { dark: "#0b0c11", light: "#f2f4fa" },
        });
        if (!cancelled) setQr(svg);
      } catch {
        // Канал мог исчезнуть, пока мы запрашивали ссылку — не роняем экран.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const url = code ? `${location.host}/j/${code}` : "";

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/j/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Без https clipboard недоступен — ссылка всё равно видна и её можно выделить.
    }
  };

  return (
    <button className="invite-tile" onClick={copy} type="button">
      {qr ? (
        <span
          className="invite-tile__qr"
          // Строка приходит из локального генератора QR, не из сети.
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      ) : (
        <span className="invite-tile__qr" />
      )}
      <span className="invite-tile__link">{url || "готовим ссылку…"}</span>
      <span className="invite-tile__hint">
        {copied ? "Ссылка скопирована" : "Наведи камерой телефона\nили просто кинь ссылку"}
      </span>
    </button>
  );
}
