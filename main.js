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
