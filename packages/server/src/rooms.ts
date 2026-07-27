import type { Participant } from "@badyum/shared";

export interface Member extends Participant {
  channelId: string;
}

export type RoomEvent =
  | { type: "joined"; channelId: string; member: Member; others: Member[] }
  | { type: "left"; channelId: string; userId: string; remaining: number }
  | { type: "state"; channelId: string; member: Member };

export type JoinResult =
  | { ok: true; others: Member[] }
  | { ok: false; error: "channel_full" | "already_joined" };

/**
 * Кто в какой комнате. Ровно это, и ничего больше — сервер не касается медиа.
 *
 * Вынесено отдельным классом без сети и без WebSocket, чтобы поведение можно
 * было проверить юнит-тестами: именно здесь живут гонки входа/выхода, которые
 * в mesh-топологии дороже всего отлаживать вручную.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Map<string, Member>>();
  private readonly maxParticipants: number;

  constructor(maxParticipants: number) {
    this.maxParticipants = maxParticipants;
  }

  join(member: Member): JoinResult {
    let room = this.rooms.get(member.channelId);
    if (!room) {
      room = new Map();
      this.rooms.set(member.channelId, room);
    }

    if (room.has(member.userId)) return { ok: false, error: "already_joined" };
    if (room.size >= this.maxParticipants) return { ok: false, error: "channel_full" };

    const others = [...room.values()];
    room.set(member.userId, member);
    return { ok: true, others };
  }

  leave(channelId: string, userId: string): { removed: boolean; remaining: number } {
    const room = this.rooms.get(channelId);
    if (!room) return { removed: false, remaining: 0 };

    const removed = room.delete(userId);
    if (room.size === 0) this.rooms.delete(channelId);
    return { removed, remaining: room.size };
  }

  /**
   * Точечное обновление состояния. `speaking` считает сам клиент по локальному
   * потоку — сервер только раздаёт это остальным.
   */
  setState(
    channelId: string,
    userId: string,
    patch: { muted?: boolean; deafened?: boolean; speaking?: boolean },
  ): Member | undefined {
    const member = this.rooms.get(channelId)?.get(userId);
    if (!member) return undefined;

    if (patch.muted !== undefined) member.muted = patch.muted;
    if (patch.deafened !== undefined) member.deafened = patch.deafened;
    if (patch.speaking !== undefined) member.speaking = patch.speaking;

    // "Оглох" всегда подразумевает выключенный микрофон: слушать не могу, но
    // говорю — это состояние, которого пользователь не ожидает.
    if (member.deafened) member.muted = true;
    if (member.muted) member.speaking = false;

    return member;
  }

  members(channelId: string): Member[] {
    const room = this.rooms.get(channelId);
    return room ? [...room.values()] : [];
  }

  has(channelId: string, userId: string): boolean {
    return this.rooms.get(channelId)?.has(userId) ?? false;
  }

  size(channelId: string): number {
    return this.rooms.get(channelId)?.size ?? 0;
  }

  isEmpty(channelId: string): boolean {
    return this.size(channelId) === 0;
  }
}
