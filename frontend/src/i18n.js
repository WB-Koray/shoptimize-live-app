// ── Shoptimize Live — i18n translations ──────────────────────────────────────

const translations = {
  en: {
    // Login
    'login.subtitle':       'Real-time store activity',
    'login.username':       'Username',
    'login.username_help':  'Email used during OAuth installation',
    'login.brand':          'Brand',
    'login.brand_help':     "Usually 'default'",
    'login.password':       'Password',
    'login.submit':         'Log In',
    'login.submitting':     'Logging in...',
    'login.err.required':   'Username and password are required',
    'login.err.server':     'Could not connect to server',
    'login.err.billing':    'Subscription required to access dashboard',
    'login.billing_activate': 'Activate your subscription →',

    // Shopify re-auth
    'login.shopify_title':      'Sign In with Shopify',
    'login.shopify_placeholder':'mystore.myshopify.com',
    'login.shopify_help':       'Enter your store address to log in via Shopify',
    'login.shopify_btn':        'Continue with Shopify',

    // WA access link
    'login.wa_title':           'Send Access Link via WhatsApp',
    'login.wa_placeholder':     '+90 5xx xxx xx xx',
    'login.wa_help':            "We'll send a login link to your WhatsApp number",
    'login.wa_btn':             'Send Link',
    'login.wa_sent':            '✅ Link sent! Check your WhatsApp.',
    'login.wa_not_found':       'Phone number not found in our system.',
    'login.wa_unavailable':     'WhatsApp access is not yet configured.',

    // Onboarding modal
    'onboarding.title':         'Setup Complete!',
    'onboarding.body':          'Your store is connected. Add your WhatsApp number to receive login links and notifications.',
    'onboarding.phone_label':   'Your WhatsApp Number',
    'onboarding.phone_placeholder': '+90 5xx xxx xx xx',
    'onboarding.save':          'Save & Continue',
    'onboarding.skip':          'Skip for now',
    'onboarding.saved':         '✅ Number saved!',

    // Connection status
    'status.live':          'Live',
    'status.connecting':    'Connecting...',
    'status.disconnected':  'Disconnected',

    // Navigation
    'nav.live':       'Live',
    'nav.wa':         'WA Automation',
    'nav.logout':     'Logout',
    'nav.realtime':   'Live',
    'nav.analytics':  'Analytics',

    // Pixel panel
    'pixel.installed':            'Storefront Pixel Installed',
    'pixel.not_installed':        'Storefront Pixel Not Installed',
    'pixel.tracking_id':          'Tracking ID',
    'pixel.install_prompt':       'Install the pixel to track visitor activity',
    'pixel.active_via_shopify':   'Active via Shopify',
    'pixel.installing':           'Installing...',
    'pixel.order_active':         'Order Tracking Active',
    'pixel.order_setup':          'Set Up Order Tracking',
    'pixel.remove':               'Remove',
    'pixel.one_click':            'One-Click Install',
    'pixel.uninstall_confirm':    'Pixel will be removed and tracking will stop. Are you sure?',

    // Stat cards
    'stat.events':          'Events',
    'stat.events_sub':      'Page interactions',
    'stat.visitors':        'Visitors',
    'stat.visitors_sub':    'Unique sessions',
    'stat.members':         'Members',
    'stat.members_sub':     'Logged-in users',
    'stat.cart':            'Add to Cart',
    'stat.cart_sub':        'Cart events',
    'stat.checkout':        'Checkout',
    'stat.checkout_sub':    'Started checkout',
    'stat.orders':          'Orders',
    'stat.orders_sub':      'Completed today',
    'stat.revenue':         'Today Rev.',
    'stat.revenue_sub':     'Revenue tracked',
    'stat.abandoned':       'Abandoned',
    'stat.abandoned_sub':   'Not converted yet',

    // Drill-down modal titles
    'drill.all_events':       'All Events',
    'drill.visitors':         'Unique Visitors',
    'drill.members':          'Logged-In Members',
    'drill.cart_products':    'Products Added to Cart',
    'drill.checkout_visitors':'Visitors Who Started Checkout',
    'drill.orders':           'Completed Orders',
    'drill.revenue':          'Revenue',
    'drill.abandoned':        'Abandoned Checkouts',
    'drill.abandoned_sub':    'Started checkout, did not complete (15+ min)',

    // Abandoned checkout box
    'abandoned.title':  'Abandoned Checkouts',

    // Visitor section
    'visitors.title':     'Active Visitors',
    'visitors.extra':     'Click card → see journey',
    'visitors.returning': '↩ Returning',
    'visitors.more':      '+{n} more',

    // Live feed
    'feed.title':         'Live Feed',
    'feed.pause':         '⏸ Pause',
    'feed.resume':        '▶ Resume',
    'feed.no_events':     'No events yet',
    'feed.no_events_sub': 'Visit your store — activity will appear here in real-time',

    // How it works (empty state)
    'howto.title': 'How It Works',
    'howto.s1':    '① Click "One-Click Install" → pixel is installed automatically',
    'howto.s2':    '② When customers visit your store, activity streams here in real-time',
    'howto.s3':    '③ Product views, add-to-cart, and checkout events are tracked live',

    // Analytics accordions
    'analytics.products':        'Most Viewed Products',
    'analytics.collections':     'Collections',
    'analytics.searches':        'Live Searches',
    'analytics.traffic':         'Traffic Sources',
    'analytics.traffic_click':   'Click → see products',
    'analytics.pages':           'Page Statistics',
    'analytics.not_found':       'Not Found Pages',
    'analytics.utm':             'UTM Campaigns',
    'analytics.no_products':     'No product views yet',
    'analytics.no_collections':  'No collection views yet',
    'analytics.no_searches':     'No searches yet',

    // Product card
    'product.views':     'Views',
    'product.cart':      'Add to Cart',
    'product.conv':      'conversion',

    // Visitor card / journey modal shared
    'common.member':     'Member #',
    'common.views':      'views',
    'common.cart':       'cart',
    'common.visitors':   'visitors',
    'common.unique':     'unique',
    'common.hits':       'hits',
    'common.terms':      'terms',
    'common.returning':  '↩ Returning',

    // Stage labels (keyed by stage value)
    'stage.browsing':  'Browsing',
    'stage.product':   'Viewing Product',
    'stage.cart':      'In Cart',
    'stage.checkout':  'Checkout',
    'stage.converted': 'Purchased',

    // Event labels (keyed by event_type)
    'event.page_viewed':        'Page Viewed',
    'event.product_viewed':     'Product Viewed',
    'event.collection_viewed':  'Collection Viewed',
    'event.cart_viewed':        'Cart Viewed',
    'event.add_to_cart':        'Added to Cart',
    'event.checkout_started':   'Checkout Started',
    'event.checkout_completed': 'Order Completed',
    'event.search_submitted':   'Search Submitted',

    // Funnel widget
    'funnel.title':           'Conversion Funnel',
    'funnel.all_visitors':    'All Visitors',
    'funnel.viewed_product':  'Viewed Product',
    'funnel.added_to_cart':   'Added to Cart',
    'funnel.started_checkout':'Started Checkout',
    'funnel.purchased':       'Purchased',
    'funnel.conv_rate':       'Conv. Rate',
    'funnel.dropped':         'dropped',

    // Intent score
    'intent.score':           'Intent',
    'intent.high':            'High intent',
    'intent.medium':          'Medium intent',
    'intent.low':             'Low intent',

    // Order Journey modal (Shopify CustomerJourneySummary)
    'ojrn.title':             'Order Journey',
    'ojrn.first_visit':       'First Visit',
    'ojrn.last_visit':        'Last Visit',
    'ojrn.days_conv':         'Days to Convert',
    'ojrn.touchpoints':       'Touchpoints',
    'ojrn.channel':           'Channel',
    'ojrn.source':            'Source',
    'ojrn.loading':           'Loading journey…',
    'ojrn.no_data':           'No journey data available',
    'ojrn.direct':            'Direct',
    'ojrn.order_btn':         'Journey',
    'ojrn.close':             'Close',

    // RFM Widget
    'rfm.title':            'Customer Segments (RFM)',
    'rfm.customers':        'customers',
    'rfm.orders':           'orders',
    'rfm.load':             'Analyze',
    'rfm.refresh':          'Refresh',
    'rfm.loading':          'Loading…',
    'rfm.cta':              'Analyze customer value segments',
    'rfm.cta_sub':          'Groups customers by Recency, Frequency & Monetary value',
    'rfm.top10':            'Top 10',
    'rfm.anonymous':        'Anonymous',
    'rfm.seg.champions':       'Champions',
    'rfm.seg.loyal':           'Loyal',
    'rfm.seg.promising':       'Promising',
    'rfm.seg.new':             'New',
    'rfm.seg.needs_attention': 'Needs Attention',
    'rfm.seg.at_risk':         'At-Risk',
    'rfm.seg.lost':            'Lost',

    // Abandonment Intelligence Panel
    'abnd.title':    'Abandonment Intelligence',
    'abnd.at_risk':  'at-risk',
    'abnd.high':     'High',
    'abnd.medium':   'Mid',
    'abnd.low':      'Low',
    'abnd.sent':     'Sent',

    // #5 Stock Demand Alert
    'stock.title':   'Hot Products',
    'stock.subtitle':'2+ simultaneous viewers',

    // #10 Hidden Cart Detector
    'hcart.title':        'Hidden Cart',
    'hcart.now_browsing': '· now browsing',
    'hcart.more':         'more',

    // Journey modal
    'journey.event':  'event',
    'journey.first':  'First:',
    'journey.last':   'Last:',
    'journey.min':    'min',
    'journey.orders': 'orders',

    // Drill-down modal body
    'modal.viewed_products': 'Viewed Products',
    'modal.visitors':        'Visitors',
    'modal.views':           'views',
    'modal.cart':            'cart',
    'modal.no_data':         'No data',

    // Time-ago suffixes
    'time.s_ago':   's ago',
    'time.m_ago':   'm ago',
    'time.h_ago':   'h ago',

    // fmtDelay units
    'delay.min':  'min',
    'delay.hr':   'hr',
    'delay.day':  'day',

    // Browser notification
    'notif.new_order':   'New Order',
    'notif.customer':    'Customer:',
    'notif.order_body':  'A new order was placed',

    // WA Flow panel
    'flow.title':           'WhatsApp Automation',
    'flow.subtitle':        'Cart recovery sequence and order notifications',
    'flow.active':          'Active',
    'flow.inactive':        'Inactive',
    'flow.sent':            'Sent',
    'flow.tracked':         'Tracked',
    'flow.wa_attr':         'WA Attr.',
    'flow.wa_rate':         'WA Rate',
    'flow.connection':      'Connection',
    'flow.connected':       'Connected',
    'flow.wa_token':        'WhatsApp Token',
    'flow.phone_id':        'Phone Number ID',
    'flow.cart_seq':        'Cart Reminder Sequence',
    'flow.active_of':       '{n}/{total} active',
    'flow.delay':           'Delay',
    'flow.template':        'Template name',
    'flow.language':        'Language',
    'flow.cooldown':        'Duplicate Prevention',
    'flow.cooldown_sub':    "Same customer won't get a new sequence within this window",
    'flow.hrs':             'hrs',
    'flow.send_window':     'Send Window',
    'flow.send_window_sub': 'Only send WA messages within these hours (Turkey time)',
    'flow.min_cart':        'Minimum Cart Value',
    'flow.min_cart_sub':    'Skip sequence if cart total is below this amount (0 = disabled)',
    'flow.order_confirm':   'Order Confirmation WA',
    'flow.order_confirm_sub':'Auto-send when order is completed',
    'flow.save':            'Save',
    'flow.saved':           'Saved ✓',
    'flow.saving':          'Saving...',
    'flow.test':            'Test Message',
    'flow.send_btn':        'Send',
    'flow.wa_orders':       'WA Tracked Orders',
    'flow.total':           'total',
    'flow.wa_attributed':   'WA attributed',
    'flow.no_orders':       'No order details yet — new orders will appear here',
    'flow.more_items':      '+{n} more items',
    'flow.history':         'Send History',
    'flow.records':         'records',
    'flow.no_sends':        'No sends yet',
    'flow.sent_n':          '{n} sent',
    'flow.skipped_n':       '{n} skipped',
    'flow.ordered':         'Ordered',
    'flow.cooldown_skip':   'Cooldown — duplicate skipped',
    'flow.order_placed':    'Order placed',
    'flow.post_order_lbl':  'post-order',
    'flow.optout':          'Opt-out',
    'flow.optout_sub':      'Customers who reply "stop / opt-out" are added automatically.',
    'flow.add':             'Add',
    'flow.empty_list':      'Empty list',
    'flow.roi_title':       'WA Revenue Attribution',
    'flow.roi_subtitle':    'Orders linked to a WhatsApp message in the last {days} days',
    'flow.roi_orders':      'WA Orders',
    'flow.roi_revenue':     'WA Revenue',
    'flow.roi_rate':        'Attribution Rate',
    'flow.roi_days':        'days',
    'flow.roi_empty':       'No WA-attributed orders yet',
    'flow.wa_sent':         'WA Sent',
  },

  tr: {
    // Giriş
    'login.subtitle':       'Gerçek zamanlı mağaza aktivitesi',
    'login.username':       'Kullanıcı Adı',
    'login.username_help':  'OAuth kurulumunda kullandığınız e-posta',
    'login.brand':          'Marka',
    'login.brand_help':     "Genellikle 'default'",
    'login.password':       'Şifre',
    'login.submit':         'Giriş Yap',
    'login.submitting':     'Giriş yapılıyor...',
    'login.err.required':   'Kullanıcı adı ve şifre gereklidir',
    'login.err.server':     'Sunucuya bağlanılamadı',
    'login.err.billing':    'Dashboard erişimi için abonelik gereklidir',
    'login.billing_activate': 'Aboneliği aktive et →',

    // Shopify re-auth
    'login.shopify_title':      'Shopify ile Giriş Yap',
    'login.shopify_placeholder':'mystore.myshopify.com',
    'login.shopify_help':       'Mağaza adresinizi girin, Shopify üzerinden otomatik giriş yapın',
    'login.shopify_btn':        'Shopify ile Devam Et',

    // WA access link
    'login.wa_title':           'WhatsApp ile Erişim Linki Al',
    'login.wa_placeholder':     '+90 5xx xxx xx xx',
    'login.wa_help':            'WhatsApp numaranıza giriş linki gönderilecek',
    'login.wa_btn':             'Link Gönder',
    'login.wa_sent':            '✅ Link gönderildi! WhatsApp\'ınızı kontrol edin.',
    'login.wa_not_found':       'Bu numara sistemimizde kayıtlı değil.',
    'login.wa_unavailable':     'WhatsApp erişim servisi henüz yapılandırılmamış.',

    // Onboarding modal
    'onboarding.title':         'Kurulum Tamamlandı!',
    'onboarding.body':          'Mağazanız bağlandı. WhatsApp numaranızı ekleyin, giriş linkleri ve bildirimler alın.',
    'onboarding.phone_label':   'WhatsApp Numaranız',
    'onboarding.phone_placeholder': '+90 5xx xxx xx xx',
    'onboarding.save':          'Kaydet ve Devam Et',
    'onboarding.skip':          'Şimdi atla',
    'onboarding.saved':         '✅ Numara kaydedildi!',

    // Bağlantı durumu
    'status.live':          'Canlı',
    'status.connecting':    'Bağlanıyor...',
    'status.disconnected':  'Bağlantı Kesildi',

    // Navigasyon
    'nav.live':       'Canlı',
    'nav.wa':         'WA Otomasyonu',
    'nav.logout':     'Çıkış',
    'nav.realtime':   'Canlı',
    'nav.analytics':  'Analiz',

    // Pixel paneli
    'pixel.installed':            'Storefront Pixel Kurulu',
    'pixel.not_installed':        'Storefront Pixel Kurulu Değil',
    'pixel.tracking_id':          'İzleme ID',
    'pixel.install_prompt':       'Ziyaretçi aktivitesini izlemek için pixel kurun',
    'pixel.active_via_shopify':   'Shopify Üzerinden Aktif',
    'pixel.installing':           'Kuruluyor...',
    'pixel.order_active':         'Sipariş Takibi Aktif',
    'pixel.order_setup':          'Sipariş Takibini Kur',
    'pixel.remove':               'Kaldır',
    'pixel.one_click':            'Tek Tıkla Kur',
    'pixel.uninstall_confirm':    'Pixel kaldırılacak ve takip duracak. Emin misiniz?',

    // İstatistik kartları
    'stat.events':          'Etkinlikler',
    'stat.events_sub':      'Sayfa etkileşimleri',
    'stat.visitors':        'Ziyaretçiler',
    'stat.visitors_sub':    'Benzersiz oturumlar',
    'stat.members':         'Üyeler',
    'stat.members_sub':     'Giriş yapmış kullanıcılar',
    'stat.cart':            'Sepete Ekle',
    'stat.cart_sub':        'Sepet etkinlikleri',
    'stat.checkout':        'Ödeme',
    'stat.checkout_sub':    'Ödeme başlattı',
    'stat.orders':          'Siparişler',
    'stat.orders_sub':      'Bugün tamamlandı',
    'stat.revenue':         'Bugün Ciro',
    'stat.revenue_sub':     'Takip edilen ciro',
    'stat.abandoned':       'Terk Edilmiş',
    'stat.abandoned_sub':   'Henüz tamamlanmadı',

    // Detay modal başlıkları
    'drill.all_events':       'Tüm Etkinlikler',
    'drill.visitors':         'Benzersiz Ziyaretçiler',
    'drill.members':          'Üye Girişleri',
    'drill.cart_products':    'Sepete Eklenen Ürünler',
    'drill.checkout_visitors':'Ödeme Başlatan Ziyaretçiler',
    'drill.orders':           'Tamamlanan Siparişler',
    'drill.revenue':          'Ciro',
    'drill.abandoned':        'Terk Edilmiş Sepetler',
    'drill.abandoned_sub':    'Ödeme başlattı, tamamlamadı (15+ dakika)',

    // Terk edilmiş sepet kutusu
    'abandoned.title':  'Terk Edilmiş Sepetler',

    // Ziyaretçi bölümü
    'visitors.title':     'Aktif Ziyaretçiler',
    'visitors.extra':     'Karta tıkla → yolculuğu gör',
    'visitors.returning': '↩ Geri Dönen',
    'visitors.more':      '+{n} daha fazla',

    // Canlı akış
    'feed.title':         'Canlı Akış',
    'feed.pause':         '⏸ Duraklat',
    'feed.resume':        '▶ Devam',
    'feed.no_events':     'Henüz etkinlik yok',
    'feed.no_events_sub': 'Mağazanızı ziyaret edin — aktivite gerçek zamanlı burada görünür',

    // Nasıl çalışır (boş durum)
    'howto.title': 'Nasıl Çalışır',
    'howto.s1':    '① "Tek Tıkla Kur"a tıklayın → pixel otomatik kurulur',
    'howto.s2':    '② Müşteriler mağazanızı ziyaret ettiğinde aktivite gerçek zamanlı görünür',
    'howto.s3':    '③ Ürün görüntüleme, sepete ekleme ve ödeme etkinlikleri canlı izlenir',

    // Analiz sekmeleri
    'analytics.products':        'En Çok Görüntülenen Ürünler',
    'analytics.collections':     'Koleksiyonlar',
    'analytics.searches':        'Canlı Aramalar',
    'analytics.traffic':         'Trafik Kaynakları',
    'analytics.traffic_click':   'Tıkla → ürünleri gör',
    'analytics.pages':           'Sayfa İstatistikleri',
    'analytics.not_found':       'Bulunamayan Sayfalar',
    'analytics.utm':             'UTM Kampanyaları',
    'analytics.no_products':     'Henüz ürün görüntüleme yok',
    'analytics.no_collections':  'Henüz koleksiyon görüntüleme yok',
    'analytics.no_searches':     'Henüz arama yok',

    // Ürün kartı
    'product.views':     'Görüntüleme',
    'product.cart':      'Sepete Ekle',
    'product.conv':      'dönüşüm',

    // Ortak
    'common.member':     'Üye #',
    'common.views':      'görüntüleme',
    'common.cart':       'sepet',
    'common.visitors':   'ziyaretçi',
    'common.unique':     'benzersiz',
    'common.hits':       'isabet',
    'common.terms':      'terim',
    'common.returning':  '↩ Geri Dönen',

    // Aşama etiketleri
    'stage.browsing':  'Geziyor',
    'stage.product':   'Ürün Bakıyor',
    'stage.cart':      'Sepette',
    'stage.checkout':  'Ödeme',
    'stage.converted': 'Satın Aldı',

    // Etkinlik etiketleri
    'event.page_viewed':        'Sayfa Görüntülendi',
    'event.product_viewed':     'Ürün Görüntülendi',
    'event.collection_viewed':  'Koleksiyon Görüntülendi',
    'event.cart_viewed':        'Sepet Görüntülendi',
    'event.add_to_cart':        'Sepete Eklendi',
    'event.checkout_started':   'Ödeme Başlatıldı',
    'event.checkout_completed': 'Sipariş Tamamlandı',
    'event.search_submitted':   'Arama Yapıldı',

    // Dönüşüm hunisi
    'funnel.title':           'Dönüşüm Hunisi',
    'funnel.all_visitors':    'Tüm Ziyaretçiler',
    'funnel.viewed_product':  'Ürün Görüntüledi',
    'funnel.added_to_cart':   'Sepete Ekledi',
    'funnel.started_checkout':'Ödeme Başlattı',
    'funnel.purchased':       'Satın Aldı',
    'funnel.conv_rate':       'Dönüşüm',
    'funnel.dropped':         'düştü',

    // Niyet skoru
    'intent.score':           'Niyet',
    'intent.high':            'Yüksek niyet',
    'intent.medium':          'Orta niyet',
    'intent.low':             'Düşük niyet',

    // Sipariş yolculuğu modalı (Shopify CustomerJourneySummary)
    'ojrn.title':             'Sipariş Yolculuğu',
    'ojrn.first_visit':       'İlk Ziyaret',
    'ojrn.last_visit':        'Son Ziyaret',
    'ojrn.days_conv':         'Dönüşüm Günü',
    'ojrn.touchpoints':       'Temas Noktaları',
    'ojrn.channel':           'Kanal',
    'ojrn.source':            'Kaynak',
    'ojrn.loading':           'Yolculuk yükleniyor…',
    'ojrn.no_data':           'Yolculuk verisi bulunamadı',
    'ojrn.direct':            'Direkt',
    'ojrn.order_btn':         'Yolculuk',
    'ojrn.close':             'Kapat',

    // RFM Widget
    'rfm.title':            'Müşteri Segmentleri (RFM)',
    'rfm.customers':        'müşteri',
    'rfm.orders':           'sipariş',
    'rfm.load':             'Analiz Et',
    'rfm.refresh':          'Yenile',
    'rfm.loading':          'Yükleniyor…',
    'rfm.cta':              'Müşteri değer segmentlerini analiz et',
    'rfm.cta_sub':          'Müşterileri Yenilik, Sıklık ve Parasal değere göre gruplar',
    'rfm.top10':            'İlk 10',
    'rfm.anonymous':        'Anonim',
    'rfm.seg.champions':       'Şampiyonlar',
    'rfm.seg.loyal':           'Sadık',
    'rfm.seg.promising':       'Umut Verici',
    'rfm.seg.new':             'Yeni',
    'rfm.seg.needs_attention': 'İlgi Gerektirir',
    'rfm.seg.at_risk':         'Risk Altında',
    'rfm.seg.lost':            'Kayıp',

    // Abandonment Intelligence Panel
    'abnd.title':    'Terk Zekası',
    'abnd.at_risk':  'risk altında',
    'abnd.high':     'Yüksek',
    'abnd.medium':   'Orta',
    'abnd.low':      'Düşük',
    'abnd.sent':     'Gönderildi',

    // #5 Stok-Talep Alarm
    'stock.title':   'Popüler Ürünler',
    'stock.subtitle':'Eş zamanlı 2+ ziyaretçi',

    // #10 Görünmez Sepet Dedektörü
    'hcart.title':        'Görünmez Sepet',
    'hcart.now_browsing': '· şu an geziniyor',
    'hcart.more':         'daha',

    // Yolculuk modalı
    'journey.event':  'etkinlik',
    'journey.first':  'İlk:',
    'journey.last':   'Son:',
    'journey.min':    'dk',
    'journey.orders': 'sipariş',

    // Detay modal gövdesi
    'modal.viewed_products': 'Görüntülenen Ürünler',
    'modal.visitors':        'Ziyaretçiler',
    'modal.views':           'görüntüleme',
    'modal.cart':            'sepet',
    'modal.no_data':         'Veri yok',

    // Zaman öneki
    'time.s_ago':   'sn önce',
    'time.m_ago':   'dk önce',
    'time.h_ago':   'sa önce',

    // Gecikme birimleri
    'delay.min':  'dk',
    'delay.hr':   'sa',
    'delay.day':  'gün',

    // Tarayıcı bildirimi
    'notif.new_order':   'Yeni Sipariş',
    'notif.customer':    'Müşteri:',
    'notif.order_body':  'Yeni bir sipariş verildi',

    // WA Akış paneli
    'flow.title':           'WhatsApp Otomasyonu',
    'flow.subtitle':        'Sepet kurtarma dizisi ve sipariş bildirimleri',
    'flow.active':          'Aktif',
    'flow.inactive':        'Pasif',
    'flow.sent':            'Gönderildi',
    'flow.tracked':         'Takip',
    'flow.wa_attr':         'WA Attr.',
    'flow.wa_rate':         'WA Oran',
    'flow.connection':      'Bağlantı',
    'flow.connected':       'Bağlı',
    'flow.wa_token':        'WhatsApp Token',
    'flow.phone_id':        'Telefon No ID',
    'flow.cart_seq':        'Sepet Hatırlatma Dizisi',
    'flow.active_of':       '{n}/{total} aktif',
    'flow.delay':           'Gecikme',
    'flow.template':        'Şablon adı',
    'flow.language':        'Dil',
    'flow.cooldown':        'Tekrar Önleme',
    'flow.cooldown_sub':    'Aynı müşteri bu süre içinde yeni dizi almaz',
    'flow.hrs':             'saat',
    'flow.send_window':     'Gönderim Penceresi',
    'flow.send_window_sub': 'WA mesajlarını yalnızca bu saatler arasında gönder (Türkiye saati)',
    'flow.min_cart':        'Minimum Sepet Tutarı',
    'flow.min_cart_sub':    'Sepet toplamı bu tutarın altındaysa diziyi atla (0 = devre dışı)',
    'flow.order_confirm':   'Sipariş Onay WA',
    'flow.order_confirm_sub':'Sipariş tamamlandığında otomatik gönder',
    'flow.save':            'Kaydet',
    'flow.saved':           'Kaydedildi ✓',
    'flow.saving':          'Kaydediliyor...',
    'flow.test':            'Test Mesajı',
    'flow.send_btn':        'Gönder',
    'flow.wa_orders':       'WA Takipli Siparişler',
    'flow.total':           'toplam',
    'flow.wa_attributed':   'WA atfedilen',
    'flow.no_orders':       'Henüz sipariş detayı yok — yeni siparişler burada görünür',
    'flow.more_items':      '+{n} daha fazla ürün',
    'flow.history':         'Gönderim Geçmişi',
    'flow.records':         'kayıt',
    'flow.no_sends':        'Henüz gönderim yok',
    'flow.sent_n':          '{n} gönderildi',
    'flow.skipped_n':       '{n} atlandı',
    'flow.ordered':         'Sipariş Verildi',
    'flow.cooldown_skip':   'Bekleme — tekrar atlandı',
    'flow.order_placed':    'Sipariş verildi',
    'flow.post_order_lbl':  'sipariş sonrası',
    'flow.optout':          'Opt-out',
    'flow.optout_sub':      '"stop / opt-out" yazan müşteriler otomatik eklenir.',
    'flow.add':             'Ekle',
    'flow.empty_list':      'Boş liste',
    'flow.roi_title':       'WA Ciro Atıfı',
    'flow.roi_subtitle':    'Son {days} günde WA mesajından gelen siparişler',
    'flow.roi_orders':      'WA Siparişi',
    'flow.roi_revenue':     'WA Cirosu',
    'flow.roi_rate':        'Atıf Oranı',
    'flow.roi_days':        'gün',
    'flow.roi_empty':       'Henüz WA atıflı sipariş yok',
    'flow.wa_sent':         'WA Gönderildi',
  },
};

export default translations;
