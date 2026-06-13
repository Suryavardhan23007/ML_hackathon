// bandit.js
export class EpsilonGreedy {
  constructor(arms = ['text','audio','images'], eps = 0.2) {
    this.eps = eps;
    this.arms = arms;
    this.counts = new Array(arms.length).fill(0);
    this.values = new Array(arms.length).fill(0);
  }
  choose() {
    if (Math.random() < this.eps) return Math.floor(Math.random()*this.arms.length);
    const maxVal = Math.max(...this.values);
    return this.values.indexOf(maxVal);
  }
  update(chosenIndex, reward) {
    this.counts[chosenIndex] += 1;
    const n = this.counts[chosenIndex];
    // incremental mean update
    this.values[chosenIndex] = ((n-1)/n)*this.values[chosenIndex] + (1/n)*reward;
  }
  seedFromProfile(profilePrediction, gmm_probs=null) {
    // profilePrediction: integer cluster index or mapping to modality preference
    // gmm_probs: optional array of soft cluster probs to seed values
    // naive mapping: assume cluster->preferred arm mapping (edit as you like)
    // Example mapping: cluster 0 -> audio, 1 -> text, 2 -> images (tweak after inspecting cluster centroids)
    const clusterToArm = {0:'audio', 1:'text', 2:'images'}; // adjust after you inspect clusters
    // if rf predicted a cluster
    if (typeof profilePrediction === 'number') {
      const armName = clusterToArm[profilePrediction];
      const armIndex = this.arms.indexOf(armName);
      if (armIndex >= 0) {
        // set a higher prior value for armIndex
        this.values[armIndex] = Math.max(this.values[armIndex], 0.7);
        this.counts[armIndex] = Math.max(this.counts[armIndex], 1);
      }
    }
    // if gmm_probs present, distribute small priors proportionally
    if (Array.isArray(gmm_probs)) {
      for (let i=0;i<gmm_probs.length;i++){
        const armName = clusterToArm[i];
        const armIndex = this.arms.indexOf(armName);
        if (armIndex>=0) {
          // blend: current value becomes weighted average with prob
          const p = gmm_probs[i];
          this.values[armIndex] = Math.max(this.values[armIndex], p*0.6);
          this.counts[armIndex] = Math.max(this.counts[armIndex], 1);
        }
      }
    }
  }
  snapshot() { return {arms:this.arms, counts:this.counts, values:this.values}; }
}
