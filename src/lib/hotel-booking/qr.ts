import QRCode from 'qrcode'

export async function upiQrPng(upiLink: string): Promise<Buffer> {
  return QRCode.toBuffer(upiLink, {
    type: 'png',
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M',
  })
}
