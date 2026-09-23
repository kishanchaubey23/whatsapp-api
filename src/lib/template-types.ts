/** Shared template schema — each card is a preset of this shape */

export type HeaderKind =
  | 'none'
  | 'text'
  | 'image'
  | 'document'
  | 'video'
  | 'audio'
  | 'location';

export type ButtonsKind =
  | 'none'
  | 'quick_reply'
  | 'cta'
  | 'copy_code'
  | 'list_menu'
  | 'mixed'
  | 'contact'
  | 'poll';

export type TemplateTypeId =
  | 'text'
  | 'image'
  | 'document'
  | 'contact'
  | 'poll'
  | 'buttons'
  | 'list'
  | 'location'
  | 'video'
  | 'audio'
  | 'cta'
  | 'copy_code'
  | 'mixed';

export type TemplateTypeDef = {
  id: TemplateTypeId;
  label: string;
  hint: string;
  header: HeaderKind;
  buttons: ButtonsKind;
  icon: string;
};

/** No Flow / Carousel */
export const TEMPLATE_TYPES: TemplateTypeDef[] = [
  { id: 'text', label: 'Text Message', hint: 'Simple text with variables', header: 'none', buttons: 'none', icon: 'text' },
  { id: 'image', label: 'Message + Image', hint: 'Image header + body', header: 'image', buttons: 'none', icon: 'image' },
  { id: 'document', label: 'Message + Document', hint: 'PDF/DOC header', header: 'document', buttons: 'none', icon: 'doc' },
  { id: 'contact', label: 'Message + Contact', hint: 'Share contact card(s)', header: 'none', buttons: 'contact', icon: 'contact' },
  { id: 'poll', label: 'Message + Poll', hint: 'Custom interactive poll', header: 'none', buttons: 'poll', icon: 'poll' },
  { id: 'buttons', label: 'Message + Buttons', hint: 'Up to 3 buttons', header: 'none', buttons: 'quick_reply', icon: 'buttons' },
  { id: 'list', label: 'Message + List', hint: 'List menu (max 10 rows)', header: 'none', buttons: 'list_menu', icon: 'list' },
  { id: 'location', label: 'Message + Location', hint: 'Pinned location header', header: 'location', buttons: 'none', icon: 'location' },
  { id: 'video', label: 'Message + Video', hint: 'MP4 header (16MB)', header: 'video', buttons: 'none', icon: 'video' },
  { id: 'audio', label: 'Message + Audio', hint: 'Audio attachment', header: 'audio', buttons: 'none', icon: 'audio' },
  { id: 'cta', label: 'CTA Button', hint: 'Single URL or call CTA', header: 'none', buttons: 'cta', icon: 'cta' },
  { id: 'copy_code', label: 'Copy Code', hint: 'Promo / coupon code button', header: 'none', buttons: 'copy_code', icon: 'copy' },
  { id: 'mixed', label: 'Mixed Interactive Buttons', hint: 'Mix reply + URL + call', header: 'none', buttons: 'mixed', icon: 'mixed' },
];

export type ButtonRow = {
  id: string;
  label: string;
  type: 'quick_reply' | 'url' | 'call';
  url?: string;
  phone?: string;
};

export type ListSection = {
  id: string;
  title: string;
  rows: { id: string; title: string; description: string }[];
};

export type ContactCard = {
  id: string;
  name: string;
  phone: string;
  email: string;
  org: string;
};

export type SavedTemplate = {
  id: string;
  type: TemplateTypeId;
  name: string;
  category: string;
  body: string;
  footer: string;
  createdAt: string;
  // media
  mediaName?: string;
  mediaUrlMode?: 'upload' | 'variable';
  mediaVariable?: string;
  docFilename?: string;
  // location
  lat?: string;
  lng?: string;
  locationName?: string;
  locationAddress?: string;
  // contacts
  contacts?: ContactCard[];
  // poll
  pollQuestion?: string;
  pollOptions?: string[];
  pollMulti?: boolean;
  // buttons
  buttons?: ButtonRow[];
  // list
  listButtonText?: string;
  listSections?: ListSection[];
  // copy code
  copyLabel?: string;
  copyExample?: string;
};

export const CATEGORIES = ['General', 'Marketing', 'Utility', 'Authentication', 'Support'] as const;

export function emptyTemplate(type: TemplateTypeId = 'text'): Omit<SavedTemplate, 'id' | 'createdAt'> {
  return {
    type,
    name: '',
    category: 'General',
    body: '',
    footer: '',
    mediaUrlMode: 'upload',
    mediaVariable: '{{image_url}}',
    contacts: [{ id: crypto.randomUUID(), name: '', phone: '', email: '', org: '' }],
    pollQuestion: '',
    pollOptions: ['Option 1', 'Option 2'],
    pollMulti: false,
    buttons: [{ id: crypto.randomUUID(), label: '', type: 'quick_reply' }],
    listButtonText: 'View Options',
    listSections: [
      {
        id: crypto.randomUUID(),
        title: 'Section 1',
        rows: [{ id: crypto.randomUUID(), title: 'Row 1', description: '' }],
      },
    ],
    copyLabel: 'Copy Code',
    copyExample: 'SAVE20',
    lat: '',
    lng: '',
    locationName: '',
    locationAddress: '',
  };
}
