import { Chart } from 'chart.js/auto';

// Initialize Chart
const ctx = document.getElementById('savingsChart');

/* Chart logic disabled for new Comparison Table design
if (ctx) {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#64748B';

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'],
            datasets: [
                {
                    label: 'Subscription Apps (e.g. YNAB)',
                    data: [109, 218, 327, 436, 545],
                    backgroundColor: '#FCA5A5', // Soft Red
                    hoverBackgroundColor: '#EF4444',
                    borderRadius: 8,
                    barPercentage: 0.6,
                },
                {
                    label: 'Zeroed (One-Time)',
                    data: [39.99, 39.99, 39.99, 39.99, 39.99],
                    backgroundColor: '#2563EB', // Brand Blue
                    hoverBackgroundColor: '#1d4ed8',
                    borderRadius: 8,
                    barPercentage: 0.6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: {
                            size: 14,
                            weight: 500
                        }
                    }
                },
                tooltip: {
                    backgroundColor: '#0F172A',
                    titleColor: '#F8FAFC',
                    bodyColor: '#F8FAFC',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += '$' + context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        display: true,
                        color: '#E2E8F0',
                        drawBorder: false,
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        callback: function (value) {
                            return '$' + value;
                        }
                    },
                    border: {
                        display: false
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 13,
                            weight: 500
                        }
                    }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}
*/


// Auto-Slideshow Logic
document.addEventListener('DOMContentLoaded', () => {
    const slidesContainer = document.querySelector('.slides-container');
    const slides = document.querySelectorAll('.slide-image');
    const prevBtn = document.querySelector('.slide-nav-btn.prev');
    const nextBtn = document.querySelector('.slide-nav-btn.next');

    // Only proceed if elements exist
    if (slidesContainer && slides.length > 0) {
        let currentIndex = 0;
        const intervalTime = 5000; // 5 seconds
        let slideInterval;
        let isPaused = false;

        function scrollToSlide(index) {
            // Handle wrapping
            if (index >= slides.length) {
                currentIndex = 0;
            } else if (index < 0) {
                currentIndex = slides.length - 1;
            } else {
                currentIndex = index;
            }

            const targetSlide = slides[currentIndex];

            // Calculate center position based on relative offset
            // We use the same robust logic as before
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
            // Clear existing to avoid multiples
            if (slideInterval) clearInterval(slideInterval);

            slideInterval = setInterval(() => {
                if (!isPaused) {
                    scrollToSlide(currentIndex + 1);
                }
            }, intervalTime);
        }

        function stopSlideshow() {
            clearInterval(slideInterval);
        }

        // --- Event Listeners ---

        // Controls
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                scrollToSlide(currentIndex + 1);
                // Reset timer on manual interaction
                startSlideshow();
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                scrollToSlide(currentIndex - 1);
                // Reset timer on manual interaction
                startSlideshow();
            });
        }

        // Pause on Hover
        const hoverTarget = document.querySelector('.slides-container-wrapper') || slidesContainer;

        hoverTarget.addEventListener('mouseenter', () => {
            isPaused = true;
        });

        hoverTarget.addEventListener('mouseleave', () => {
            isPaused = false;
        });

        // Initialize
        // startSlideshow(); // <-- Removed immediate start

        // --- Intersection Observer for Visibility ---
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1 // Trigger when 10% visible
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    console.log('Slideshow entering viewport: User is viewing.');
                    startSlideshow();
                } else {
                    console.log('Slideshow leaving viewport: Stopping.');
                    stopSlideshow();
                }
            });
        }, observerOptions);

        // Observe the entire section or the wrapper
        const section = document.querySelector('#mobile-slides');
        if (section) {
            observer.observe(section);
        } else {
            // Fallback if section ID missing
            observer.observe(slidesContainer);
        }
    }
});
