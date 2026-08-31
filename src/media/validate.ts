import sharp from 'sharp';
const formats=new Set(['png','jpeg','webp']);
export async function inspectImage(bytes:Buffer){if(bytes.length>10*1024*1024)throw new Error('Image exceeds 10 MB');const m=await sharp(bytes).metadata();if(!m.format||!formats.has(m.format)||!m.width||!m.height)throw new Error('Unsupported or invalid image');return{format:m.format,width:m.width,height:m.height,mime:m.format==='jpeg'?'image/jpeg':`image/${m.format}`};}
