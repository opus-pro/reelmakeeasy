export interface UserInfo {
  aud: string[]
  country: string
  //deprecated
  email: string
  exp: number
  iat: number
  identity_nonce: string
  iss: string
  name?: string
  nbf: number

  // standard auth info
  orgId: string
  //deprecated
  sub: string
  type: string

  user_id?: string
  // standard auth info
  userId: string
}
