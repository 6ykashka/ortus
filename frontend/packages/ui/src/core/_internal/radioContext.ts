import { createContext } from 'react';

/** Вид радио задаёт `RadioGroup`: плитки (Дизайн-система.dc.html:238) или карточки (Ортус CRM.dc.html:2252). */
export const RadioVariantContext = createContext<'tiles' | 'cards'>('tiles');
