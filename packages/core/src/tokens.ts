import { SignedValues } from "./signed.ts";

export interface JoinClaims {
  userId: string;
  channelId: string;
  displayName: string;
  /** Код инвайта, по которому вошли — чтобы засчитать использование. */
  inviteCode: string | null;
  /** Устойчивая личность, если клиент её прислал. Прав не даёт, см. протокол. */
  identityId?: string | null;
  /**
   * Аватарка вошедшего.
   *
   * В токене, а не в базе: канал раздаёт участников сам и в D1 за ними не
   * ходит — иначе каждый вход стоил бы запроса к базе на каждого в комнате.
   * Подпись токена делает поле таким же надёжным, как остальные.
   */
  avatarUrl?: string | null;
  exp: number;
  /** Токен переподключения: длинный срок жизни, инвайт уже не засчитывается. */
  resume?: boolean;
}

/** Сколько живёт токен входа: он нужен только чтобы открыть WebSocket. */
export const TOKEN_TTL_SECONDS = 120;

/**
 * Токен переподключения. Живёт долго намеренно: обрыв связи в метро или переход
 * с Wi-Fi на LTE легко длится минуты, и всё это время человек должен иметь
 * возможность молча вернуться в тот же канал под тем же именем.
 */
export const RESUME_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Токены входа в канал.
 *
 * Делают ровно одно: разрешают открыть WebSocket в конкретный канал под
 * конкретным именем. Подпись и срок живут в SignedValues — здесь остаётся
 * только смысл: какие поля и на сколько.
 */
export class TokenSigner {
  private readonly signer: SignedValues;

  constructor(secret: string) {
    this.signer = new SignedValues(secret);
  }

  signJoinToken(claims: Omit<JoinClaims, "exp">): Promise<string> {
    return this.signer.sign(claims, TOKEN_TTL_SECONDS);
  }

  /**
   * Токен возврата в тот же канал под тем же userId.
   *
   * inviteCode намеренно сбрасывается: переподключение не должно повторно
   * съедать использование одноразовой ссылки.
   */
  signResumeToken(claims: Omit<JoinClaims, "exp" | "resume">): Promise<string> {
    return this.signer.sign(
      { ...claims, inviteCode: null, resume: true },
      RESUME_TOKEN_TTL_SECONDS,
    );
  }

  async verify(token: string): Promise<JoinClaims | null> {
    const claims = await this.signer.verify<Omit<JoinClaims, "exp">>(token);
    if (!claims) return null;

    // Подпись верна, но полей может не хватать: токен мог быть выпущен другой
    // версией сервиса. Пускать такой внутрь — значит уронить обработчик дальше.
    if (!claims.userId || !claims.channelId || !claims.displayName) return null;
    return claims as JoinClaims;
  }
}
