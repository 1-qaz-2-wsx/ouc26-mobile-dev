// pages/index/index.js
Page({
  data: {
    pets: [
      { wording: 'hello dog', image: '/img/sausage-hotdog.jpg', emoji: '🐕' },
      { wording: 'hello orange cat', image: '/img/orange-cat.jpg', emoji: '🐈' },
      { wording: 'hello black cat', image: '/img/black-cat.jpg', emoji: '🐈‍⬛' },
      { wording: 'hello white cat', image: '/img/white-cat.jpg', emoji: '🐈' }
    ],
    currentIndex: 0,
    currentPet: {
      wording: 'hello dog',
      image: '/img/sausage-hotdog.jpg',
      emoji: '🐕'
    }
  },

  changePet() {
    const nextIndex = (this.data.currentIndex + 1) % this.data.pets.length

    this.setData({
      currentIndex: nextIndex,
      currentPet: this.data.pets[nextIndex]
    })
  }
})
