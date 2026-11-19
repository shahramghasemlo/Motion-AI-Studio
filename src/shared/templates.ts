export interface StarterTemplate {
  id: string;
  titleFa: string;
  titleEn: string;
  categoryFa: string;
  categoryEn: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  durationSeconds: number;
  designStyle: string;
  descriptionFa: string;
  descriptionEn: string;
  accentHex: string;
  defaultScenes: Array<{
    titleFa: string;
    titleEn: string;
    durationMs: number;
    textFa: string;
    textEn: string;
    animationPreset: string;
    transitionType: string;
  }>;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'ecommerce_flash_sale',
    titleFa: 'تبلیغ فروش ویژه فروشگاهی',
    titleEn: 'E-Commerce Flash Promo',
    categoryFa: 'تبلیغات تخفیف و فروشگاهی',
    categoryEn: 'Retail & Discount',
    aspectRatio: '9:16',
    durationSeconds: 15,
    designStyle: 'bold_kinetic',
    descriptionFa: 'ریتم سریع با تایپوگرافی برجسته برای معرفی تخفیف‌های محدود در ریلز و استوری.',
    descriptionEn: 'Fast-paced kinetic typography tailored for Reels and limited-time offers.',
    accentHex: '#2563EB',
    defaultScenes: [
      {
        titleFa: 'شروع جذاب (Hook)',
        titleEn: 'Attention Hook',
        durationMs: 3000,
        textFa: 'فقط تا پایان امشب!',
        textEn: 'Tonight Only — Limited Drop',
        animationPreset: 'zoom_in_pop',
        transitionType: 'slide_left',
      },
      {
        titleFa: 'معرفی محصول و تخفیف',
        titleEn: 'Product & Offer',
        durationMs: 6000,
        textFa: 'تا ۴۰٪ تخفیف روی کالکشن جدید',
        textEn: 'Up to 40% Off New Collection',
        animationPreset: 'fade_slide_up',
        transitionType: 'cross_dissolve',
      },
      {
        titleFa: 'دعوت به اقدام (CTA)',
        titleEn: 'Call To Action',
        durationMs: 6000,
        textFa: 'همین حالا سفارش دهید',
        textEn: 'Order Now',
        animationPreset: 'scale_reveal',
        transitionType: 'fade_out',
      },
    ],
  },
  {
    id: 'product_minimal_launch',
    titleFa: 'رونمایی مینیمال محصول',
    titleEn: 'Minimal Product Launch',
    categoryFa: 'معرفی محصول',
    categoryEn: 'Product Showcase',
    aspectRatio: '16:9',
    durationSeconds: 20,
    designStyle: 'modern_minimal',
    descriptionFa: 'قاب‌بندی تمیز، حرکت نرم دوربین و نمایش ویژگی‌های کلیدی برای یوتیوب و وب‌سایت.',
    descriptionEn: 'Clean framing, smooth camera motion, and feature callouts for YouTube & web.',
    accentHex: '#0EA5E9',
    defaultScenes: [
      {
        titleFa: 'معرفی برند',
        titleEn: 'Brand Intro',
        durationMs: 4000,
        textFa: 'نسل تازه طراحی هوشمند',
        textEn: 'The Next Generation of Design',
        animationPreset: 'fade_in',
        transitionType: 'cross_dissolve',
      },
      {
        titleFa: 'نمایش مزایا',
        titleEn: 'Key Benefits',
        durationMs: 10000,
        textFa: 'سرعت، دقت و دوام بی‌رقیب',
        textEn: 'Unmatched Speed & Precision',
        animationPreset: 'pan_horizontal',
        transitionType: 'wipe_right',
      },
      {
        titleFa: 'پایان‌بندی',
        titleEn: 'Outro & CTA',
        durationMs: 6000,
        textFa: 'آینده را تجربه کنید',
        textEn: 'Experience What Is Next',
        animationPreset: 'logo_reveal',
        transitionType: 'fade_out',
      },
    ],
  },
  {
    id: 'cafe_restaurant_story',
    titleFa: 'معرفی منوی کافه و رستوران',
    titleEn: 'Cafe & Culinary Spotlight',
    categoryFa: 'رستوران و کافه',
    categoryEn: 'Food & Cafe',
    aspectRatio: '4:5',
    durationSeconds: 15,
    designStyle: 'warm_editorial',
    descriptionFa: 'نمایش اشتهاآور محصول با تایپوگرافی خوانا مناسب پست عمودی اینستاگرام.',
    descriptionEn: 'Appetizing visual pacing with legible editorial titles for 4:5 vertical posts.',
    accentHex: '#D97706',
    defaultScenes: [
      {
        titleFa: 'نمای نزدیک',
        titleEn: 'Close-Up Hook',
        durationMs: 4000,
        textFa: 'طعم واقعی قهوه تخصصی',
        textEn: 'Crafted Specialty Roast',
        animationPreset: 'slow_zoom_in',
        transitionType: 'cross_dissolve',
      },
      {
        titleFa: 'پیشنهاد ویژه',
        titleEn: 'Daily Special',
        durationMs: 7000,
        textFa: 'منوی صبحانه و برانچ هر روز',
        textEn: 'Fresh Brunch Served Daily',
        animationPreset: 'fade_slide_up',
        transitionType: 'slide_up',
      },
      {
        titleFa: 'آدرس و دعوت',
        titleEn: 'Visit CTA',
        durationMs: 4000,
        textFa: 'منتظر حضور گرمتان هستیم',
        textEn: 'Visit Us Today',
        animationPreset: 'fade_in',
        transitionType: 'fade_out',
      },
    ],
  },
  {
    id: 'saas_software_explainer',
    titleFa: 'معرفی نرم‌افزار و استارتاپ',
    titleEn: 'SaaS & App Explainer',
    categoryFa: 'معرفی نرم‌افزار',
    categoryEn: 'Software & Tech',
    aspectRatio: '1:1',
    durationSeconds: 30,
    designStyle: 'clean_corporate',
    descriptionFa: 'ساختار منظم برای معرفی قابلیت‌های پلتفرم، داشبورد و ارزش پیشنهادی.',
    descriptionEn: 'Structured explainer layout highlighting workflow speed and platform value.',
    accentHex: '#10B981',
    defaultScenes: [
      {
        titleFa: 'چالش کاربر',
        titleEn: 'The Problem',
        durationMs: 6000,
        textFa: 'مدیریت دستی زمان شما را می‌گیرد؟',
        textEn: 'Spending Hours on Manual Workflows?',
        animationPreset: 'fade_slide_up',
        transitionType: 'slide_left',
      },
      {
        titleFa: 'راه‌حل هوشمند',
        titleEn: 'The Solution',
        durationMs: 16000,
        textFa: 'همه‌چیز در یک فضای کاری یکپارچه',
        textEn: 'Everything Unified in One Studio',
        animationPreset: 'scale_reveal',
        transitionType: 'cross_dissolve',
      },
      {
        titleFa: 'شروع رایگان',
        titleEn: 'Get Started',
        durationMs: 8000,
        textFa: 'همین امروز شروع کنید',
        textEn: 'Start Building Today',
        animationPreset: 'zoom_in_pop',
        transitionType: 'fade_out',
      },
    ],
  },
];
