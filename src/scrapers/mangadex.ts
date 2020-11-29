
import { Chapter, ScraperResponse } from "../types";
import { Scraper, SearchError, SearchOptions } from "./types";
import { Mangadex } from "mangadex-api";
import fetch from "node-fetch-extra";
import { getProviderId, isProviderId } from "../routers/manga-page";
import secretConfig from "../util/secretConfig";
import chalk from "chalk";
import updateManga from "../util/updateManga";
import { error } from "./index";

class MangadexClass extends Scraper {

	private client: Mangadex | null;

	constructor() {
		super();
		this.provider = "Mangadex";
		this.canSearch = false;
		this.client = new Mangadex();
		if(secretConfig?.mangadex?.username && secretConfig?.mangadex?.password) {
			try {
				this.client.agent.login(secretConfig.mangadex.username, secretConfig.mangadex.password).then(res => {
					if(res) {
						this.canSearch = true;
						console.info(chalk.green("[MANGADEX]") + ` Signed into MangaDex`);	
					} else {
						console.error(chalk.red("[MANGADEX]") + ` Failed to sign into MangaDex`);	
					}
				});
			} catch(err) {
				this.client = null;
				console.error(chalk.red("[MANGADEX]") + ` An error occured:`, err);
			}

		} else {
			this.client = null;
			console.error(chalk.red("[SECRET]") + ` No mangadex credentials provided in secret-config. Search will be disabled.`);
		}
	}

	public scrape(slug: string, chapterId: number = -1): Promise<ScraperResponse> {
		
		return new Promise(async resolve => {

			try {
				// Prepare for timeout
				let isDone = false;
				setTimeout(() => {
					if(!isDone) {
						isDone = true;
						resolve(error(0, "This request took too long"));
						console.error(chalk.red("[MANGADEX]") + ` A request for '${slug}' at '${chapterId}' took too long and has timed out`);
					};
				}, 25e3);
				
				// Get ID
				let id = Number(slug);
			
				// Get main data
				let data = await Mangadex.manga.getManga(id);
	
				// Chapters
				let chaptersData = await Mangadex.manga.getMangaChapters(id);
				let chapters = chaptersData.chapters
				  .filter(c => c.language.includes("en") || c.language.includes("gb") || c.language.includes("nl"));
	
				// Get largest volume count
				let largestVolumeCount = 0;
				for(let chapter of chapters) {
					let volume = Number(chapter.volume);
					if(volume > largestVolumeCount) largestVolumeCount = volume;
				}

				// Map chapters to new format
				let newChapters: Chapter[] = chapters.map(c => {
					let volume = Number(c.volume) || largestVolumeCount + 1;
					let chapter = Number(c.chapter);
					return {
						season: volume,
						chapter,
						label: `V${volume} - Chapter ${chapter ?? "??"}`,
						date: new Date(c.timestamp * 1e3),
						combined: (volume * 1e5) + chapter,
						hrefString: c.id.toString()
					};
				}).sort((a, b) => a.combined - b.combined);

				// Get chapter-relevant data
				// Just images I think
				let chapterImages: string[] = [];

				if(chapterId && chapterId !== null && chapterId !== -1) {
					let chapter = await Mangadex.chapter.getChapter(Number(chapterId));
	
					let imagePromises = chapter.pages.map(async url => {
						// @ts-ignore node-fetch's TS does not have buffer in its definitions
						let base64 = await fetch(url).then(r => r.buffer()).then(buf => `data:image/${url.split(".").pop()};base64,`+buf.toString('base64'));
						return base64;
					});
	
					chapterImages = await Promise.all(imagePromises); // Page array is an array filled with URLs. Perfect!
				}

				// Get series status
				let mdStatus = [null, "ongoing", "completed", "cancelled", "hiatus"];
				let status = mdStatus[data.publication.status]; // data.manga.status is an integer, 1-indexed
	
				// Return data
				let provider = getProviderId(this.provider);
				if(!isDone) { // Check if request hasn't already timed out
					
					console.info(chalk.blue(" [MD]") + ` Resolving ${data.title} at ${new Date().toLocaleString("it")}`);

					isDone = true;
					resolve({
						constant: {
							title: data.title,
							slug,
							posterUrl: data.mainCover,
							alternateTitles: data.altTitles,
							genres: data.tags.map(n => n.toString()),
							descriptionParagraphs: data.description.split("\r\n").filter(Boolean).filter(c => !c.startsWith("[")),
							nsfw: data.isHentai
						},
						data: {
							chapters: newChapters,
							chapterImages,
							status
						},
						success: true,
						provider: isProviderId(provider) ? provider : null
					});
				}
			} catch(err) {
				console.error(chalk.red("[MANGADEX]") + ` An error occured:`, err);
				resolve(error(0, err));
			}

		});
		
	}
	public async search(query: string, options?: Partial<SearchOptions>) {
		
		const x: SearchError = {
			error: "Unable to search. Check logs for more information."
		}
		return x;

		// MangaDex takes a bit sometimes to enable search
		// Verify we can search MangaDex
		if(!this.canSearch) {
			return {
				error: "Unable to search. Check logs for more information."
			}
		}

		let searchData = await this.client.search(query); // Get search results

		// Map to Adolla style format
		let resultIds = searchData.titles.map(title => title.id)
		let searchResults = await Promise.all(resultIds
			.slice(0, query === "" ? 5 : options.resultCount)
			.map(id => updateManga("Mangadex", id.toString()) 
		));
		
		// Return Adolla-formatted search results
		return searchResults.filter(r => r.success);
	}
}

// Create instance and extend it
const Mangadex2 = new MangadexClass();
export default Mangadex2;