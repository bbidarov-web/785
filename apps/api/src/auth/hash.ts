import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

/** SERVER.md §6.1: bcrypt/argon2 вместо клиентского отпечатка прототипа. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Тот же хешер используем и для одноразовых кодов — в БД не должен лежать код в открытом виде. */
export async function hashCode(code: string): Promise<string> {
  return hash(code, { memoryCost: 8192, timeCost: 2, parallelism: 1 });
}

export async function verifyCode(codeHash: string, code: string): Promise<boolean> {
  try {
    return await verify(codeHash, code);
  } catch {
    return false;
  }
}

/** Криптостойкий 6-значный код — Math.random() прототипа не годится для сервера. */
export function generateOtp(): string {
  return String(100000 + randomInt(0, 900000));
}
