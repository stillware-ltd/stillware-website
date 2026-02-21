// Auto-Slideshow Logic
document.addEventListener('DOMContentLoaded', () => {
    const slidesContainer = document.querySelector('.slides-container');
    const slides = document.querySelectorAll('.slide-image');
    const prevBtn = document.querySelector('.slide-nav-btn.prev');
    const nextBtn = document.querySelector('.slide-nav-btn.next');

    // Only proceed if elements exist
    if (slidesContainer && slides.length > 0) {
        let currentIndex = 0;
        let slideInterval;
        let isPaused = false;

        function scrollToSlide(index) {
            if (index >= slides.length) {
                currentIndex = 0;
            } else if (index < 0) {
                currentIndex = slides.length - 1;
            } else {
                currentIndex = index;
            }

            const targetSlide = slides[currentIndex];
            const containerCenter = slidesContainer.clientWidth / 2;
            const slideCenter = targetSlide.clientWidth / 2;
            const slideLeftRelative = targetSlide.offsetLeft - slidesContainer.offsetLeft;
            const scrollLeft = slideLeftRelative - containerCenter + slideCenter;

            slidesContainer.scrollTo({
                left: scrollLeft,
                behavior: 'smooth'
            });
        }

        function startSlideshow() {
            if (slideInterval) clearTimeout(slideInterval);
            const isLastSlide = currentIndex === slides.length - 1;
            const delay = isLastSlide ? 10000 : 5000;

            slideInterval = setTimeout(() => {
                if (!isPaused) {
                    scrollToSlide(currentIndex + 1);
                    startSlideshow();
                }
            }, delay);
        }

        function stopSlideshow() {
            clearTimeout(slideInterval);
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                scrollToSlide(currentIndex + 1);
                startSlideshow();
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                scrollToSlide(currentIndex - 1);
                startSlideshow();
            });
        }

        const hoverTarget = document.querySelector('.slides-container-wrapper') || slidesContainer;

        hoverTarget.addEventListener('mouseenter', () => {
            isPaused = true;
            stopSlideshow();
        });

        hoverTarget.addEventListener('mouseleave', () => {
            isPaused = false;
            startSlideshow();
        });

        // Intersection Observer for visibility-based autoplay
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    startSlideshow();
                } else {
                    stopSlideshow();
                }
            });
        }, observerOptions);

        const section = document.querySelector('#mobile-slides');
        if (section) {
            observer.observe(section);
        } else {
            observer.observe(slidesContainer);
        }
    }
});

// Scroll Reveal Logic
document.addEventListener('DOMContentLoaded', () => {
    const revealElements = document.querySelectorAll('.reveal, .reveal-up');

    const revealOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.15
    };

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, revealOptions);

    revealElements.forEach(el => revealObserver.observe(el));
});

// Mobile Hamburger Menu
document.addEventListener('DOMContentLoaded', () => {
    const hamburgerBtn = document.querySelector('.hamburger-btn');
    const mobilePanel = document.querySelector('.mobile-nav-panel');
    const mobileOverlay = document.querySelector('.mobile-nav-overlay');

    if (hamburgerBtn && mobilePanel && mobileOverlay) {
        function toggleMenu() {
            hamburgerBtn.classList.toggle('active');
            mobilePanel.classList.toggle('active');
            mobileOverlay.classList.toggle('active');
            document.body.style.overflow = mobilePanel.classList.contains('active') ? 'hidden' : '';
        }

        hamburgerBtn.addEventListener('click', toggleMenu);
        mobileOverlay.addEventListener('click', toggleMenu);

        // Close menu when clicking a nav link
        mobilePanel.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (mobilePanel.classList.contains('active')) {
                    toggleMenu();
                }
            });
        });
    }
});

// Animated Scarcity Counter
document.addEventListener('DOMContentLoaded', () => {
    const scarcityText = document.querySelector('.scarcity-text');
    if (!scarcityText) return;

    const spans = scarcityText.querySelectorAll('span');
    if (spans.length < 2) return;

    const countSpan = spans[1]; // "430 / 500"
    const targetText = countSpan.textContent.trim();
    const match = targetText.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return;

    const targetCount = parseInt(match[1]);
    const total = match[2];
    let hasAnimated = false;

    function animateCount(element, target, totalStr) {
        const duration = 1500;
        const startTime = performance.now();
        const startVal = 0;

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(startVal + (target - startVal) * eased);
            element.textContent = `${current} / ${totalStr}`;

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !hasAnimated) {
                hasAnimated = true;
                animateCount(countSpan, targetCount, total);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    counterObserver.observe(scarcityText.closest('.scarcity-container') || scarcityText);
});
