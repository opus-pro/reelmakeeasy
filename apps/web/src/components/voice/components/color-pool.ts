// The avatar palette, in a leaf module of its own so a consumer that only
// wants the colours (the BGM version history's audition buttons) does not
// pull voice-over-selection's api and auth hooks in with them.
// Metallic radial gradient style based on Figma design - soft and natural tones
export const colorPool = [
  'radial-gradient(circle at 30% 30%, #DEDBC3, #D3C7A0, #CABF9A, #B7C9C4, #A69564)', // Cool gold-green metallic
  'radial-gradient(circle at 30% 30%, #E1C092, #D7C2A2, #C8A77F, #C58F56, #C0894E)', // Warm bronze metallic
  'radial-gradient(circle at 30% 30%, #F5D1DC, #E8B4C8, #D88BA8, #C76B92, #B44C7A)', // Soft pink metallic
  'radial-gradient(circle at 30% 30%, #D4E8F0, #B5D5E8, #8CB8D4, #6B9BC4, #4A7EB0)', // Soft blue metallic
  'radial-gradient(circle at 30% 30%, #E8F5E0, #C8E4B8, #A8D098, #88B878, #68A058)', // Soft green metallic
  'radial-gradient(circle at 30% 30%, #E8DFF5, #D4C4E8, #BDA8D8, #A68BC8, #8F6EB8)', // Soft purple metallic
  'radial-gradient(circle at 30% 30%, #F0E8D8, #E0D4C0, #D0BCA8, #C0A490, #B08C78)', // Soft tan metallic
  'radial-gradient(circle at 30% 30%, #F5E0E8, #E8C8D8, #D8A8C0, #C888A8, #B86890)', // Soft rose metallic
]

export const defaultColor = colorPool[0]
