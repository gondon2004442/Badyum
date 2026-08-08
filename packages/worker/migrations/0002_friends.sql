-- Контакты.
--
-- Одна строка на пару, а не по строке на каждую сторону: иначе на вопрос «а мы
-- уже друзья?» пришлось бы искать в двух направлениях, и рано или поздно
-- нашлась бы половина ответа — заявка есть у него, а у тебя нет.
--
-- Порядок в паре канонический: user_a всегда лексикографически меньше user_b.
-- За это отвечает pairOf в ядре, здесь же стоит CHECK, чтобы запись в обратном
-- порядке не прошла молча.

CREATE TABLE friendships (
  user_a       TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b       TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Кто позвал. Строка одна, а смотрят на неё двое: для отправителя заявка
  -- исходящая, для второго та же самая — входящая. Без этого поля их не
  -- различить.
  requested_by TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'pending' — заявка ждёт ответа, 'accepted' — друзья.
  -- Отказ строку удаляет: он значит «не сейчас», а не «никогда», и человек
  -- должен иметь возможность позвать снова.
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   INTEGER NOT NULL,

  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

-- Первичный ключ покрывает поиск по user_a, а по user_b — нет. Список друзей
-- спрашивают с обеих сторон, поэтому вторая половина нужна отдельно.
CREATE INDEX friendships_b_idx ON friendships (user_b);
