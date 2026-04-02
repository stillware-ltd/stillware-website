const fs = require('fs');
const path = require('path');

const mappings = {
    "chess_kids_1775085462259.png": "best-offline-chess-app-for-kids",
    "medication_seniors_1_1775085477189.png": "best-offline-medication-tracker-apps-for-seniors",
    "medication_seniors_2_1775085490697.png": "best-offline-medication-trackers-for-seniors",
    "car_teens_1775085501797.png": "first-car-maintenance-guide-for-teens",
    "zine_kids_1775085514338.png": "how-to-make-a-zine-for-kids-guide",
    "demo_offline_1775085537437.png": "how-to-record-a-band-demo-offline",
    "scam_seniors_1775085627114.png": "how-to-spot-a-scam-for-seniors-guide",
    "coding_kids_1775085639541.png": "how-to-teach-kids-coding-logic-without-syntax",
    "finance_kids_1775085652217.png": "how-to-teach-kids-financial-literacy-with-cash",
    "encrypt_data_1775085667810.png": "how-zeroed-encrypts-your-data",
    "privacy_budgeting_1775085688218.png": "privacy-budgeting-apps-compared"
};

const artifactDir = "C:\\Users\\User\\.gemini\\antigravity\\brain\\2187ca5b-3fdf-4c4c-bf8f-d956abbe8963";
const publicImagesDir = "C:\\Dev\\StillwareLtd\\Projects\\stillware-website\\public\\blog\\images";
const contentDir = "C:\\Dev\\StillwareLtd\\Projects\\stillware-website\\src\\content\\blog";

Object.entries(mappings).forEach(([imgFile, slug]) => {
    const src = path.join(artifactDir, imgFile);
    if (!fs.existsSync(src)) {
        console.error("Missing:", src);
        return;
    }

    // Move image
    const targetDir = path.join(publicImagesDir, slug);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const dest = path.join(targetDir, "hero.png");
    fs.copyFileSync(src, dest);
    console.log(`Copied ${imgFile} to ${slug}/hero.png`);

    // Update markdown
    const mdFile = path.join(contentDir, slug + ".md");
    if (fs.existsSync(mdFile)) {
        let content = fs.readFileSync(mdFile, 'utf-8');
        // if we already updated it, skip
        if (!content.includes('heroImage:')) {
            content = content.replace(/^---\r?\n/, `---\nheroImage: "/blog/images/${slug}/hero.png"\n`);
            fs.writeFileSync(mdFile, content);
            console.log(`Updated frontmatter in ${slug}.md`);
        }
    }
});
