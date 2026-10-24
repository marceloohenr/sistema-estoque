import bcrypt from 'bcryptjs'

const passwordRounds = 12

export function hashPassword(password) {
  return bcrypt.hash(password, passwordRounds)
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}
